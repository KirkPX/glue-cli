import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { writeFileSync } from 'fs';
import path from 'path';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue, message } from './helpers/fake-glue.js';

const home = tempHome();
const token = 'test-access-token';
const edge = (id: string, ...recipients: string[]) => ({
  node: {
    id,
    subject: id,
    threadType: 'thread',
    recipients: { edges: recipients.map((r) => ({ node: { id: r, name: r } })) },
  },
});

// Two pages for the group, newest page first. Each page runs oldest to newest.
const glue = new FakeGlue({
  SearchThreads: (variables) => {
    return variables.before
      ? { threads: { edges: [edge('thr_1', 'grp_one'), edge('thr_2', 'grp_one')], totalCount: 4, pageInfo: { hasPreviousPage: false, startCursor: null } } }
      : { threads: { edges: [edge('thr_3', 'grp_one'), edge('thr_4', 'grp_one')], totalCount: 4, pageInfo: { hasPreviousPage: true, startCursor: 'older' } } };
  },
  SearchGroups: () => ({ workspace: { groups: { edges: [{ node: { id: 'grp_one', name: 'One' } }] } } }),
  Message: (variables) => ({
    node: message(variables.messageId, 'x', [
      { __typename: 'File', id: 'fil_own', url: fileUrl('own'), name: 'own.txt', contentType: 'text/plain' },
    ]),
  }),
  DeleteMessage: () => ({ deleteMessage: true }),
});

let storage: Server;
let storagePort = 0;
const seenAuth: (string | undefined)[] = [];
let fileUrl = (_name: string) => '';

const threads = (...args: string[]) => run(['threads', ...args], { home: home.home, apiUrl: glue.url });

beforeAll(async () => {
  await glue.start();
  storage = createServer((req, res) => {
    seenAuth.push(req.headers.authorization);
    res.end('file body');
  });
  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', () => resolve()));
  storagePort = (storage.address() as AddressInfo).port;
  fileUrl = (name) => `http://127.0.0.1:${storagePort}/${name}`;
});
afterAll(async () => {
  await glue.stop();
  await new Promise<void>((resolve) => storage.close(() => resolve()));
  home.cleanup();
});

describe('threads --last', () => {
  it('--group with --last returns only the newest threads, and stops paging', async () => {
    glue.calls.length = 0;
    const result = await threads('--group', 'One', '--last', '2');
    expect(JSON.parse(result.stdout).threads.map((t: any) => t.id)).toEqual(['thr_3', 'thr_4']);
    expect(glue.callsTo('SearchThreads')).toHaveLength(1);
  });

  it('--last reaching into an older page keeps newest-last order', async () => {
    const result = await threads('--group', 'One', '--last', '3');
    expect(JSON.parse(result.stdout).threads.map((t: any) => t.id)).toEqual(['thr_2', 'thr_3', 'thr_4']);
  });

  it('--group alone still lists every thread', async () => {
    const result = await threads('--group', 'One');
    expect(JSON.parse(result.stdout).threads).toHaveLength(4);
  });

  it('--group takes a group ID as well as a name', async () => {
    glue.calls.length = 0;
    const result = await threads('--group', 'grp_one', '--last', '1');
    expect(JSON.parse(result.stdout).threads.map((t: any) => t.id)).toEqual(['thr_4']);
    expect(glue.callsTo('SearchGroups')).toHaveLength(0);
  });

  it('plain --last never returns more than asked, even if the server does', async () => {
    const result = await threads('--last', '1');
    expect(JSON.parse(result.stdout).threads.map((t: any) => t.id)).toEqual(['thr_4']);
  });

  it('refuses a --last that is not a positive whole number', async () => {
    const result = await threads('--last', 'lots');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--last');
  });
});

describe('download', () => {
  it('does not send the sign-in to a storage host', async () => {
    seenAuth.length = 0;
    const out = path.join(home.home, 'files with spaces');
    const result = await run(['download', 'msg_1', '--out', out], {
      home: home.home,
      apiUrl: glue.url.replace('127.0.0.1', 'localhost'),
    });
    expect(result.code).toBe(0);
    expect(JSON.stringify(seenAuth)).not.toContain(token);
  });
});

describe('errors from the top-level handler', () => {
  it('prints a typed JSON error with the next step when not signed in', async () => {
    const result = await run(['me'], { home: home.home, signedOut: true });
    const error = JSON.parse(result.stderr);
    expect(error.message).toBe('Not signed in.');
    expect(error.hint).toContain('glue login');
  });

  it('a 401 suggests signing in again and holds no token', async () => {
    const denied = createServer((_, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'bad Bearer test-access-token' }] }));
    });
    await new Promise<void>((resolve) => denied.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(denied.address() as AddressInfo).port}/graphql`;
    const result = await run(['me'], { home: home.home, apiUrl: url });
    await new Promise<void>((resolve) => denied.close(() => resolve()));
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain(token);
    expect(JSON.parse(result.stderr).hint).toContain('glue login --force');
  });

  it('a failed connection reads as plain words', async () => {
    const { stderr, code } = await run(['me'], { home: home.home, apiUrl: 'http://127.0.0.1:9/graphql', env: { GLUE_TIMEOUT_MS: '2000' } });
    expect(code).toBe(1);
    // Retry notices come first. The error is the last line.
    const lines = stderr.trim().split('\n');
    expect(JSON.parse(lines[lines.length - 1]).message).toContain('could not reach 127.0.0.1:9');
    expect(stderr).not.toContain('fetch failed');
  });

  it('a stalled server times out under GLUE_TIMEOUT_MS', async () => {
    const stalled = createServer(() => undefined);
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(stalled.address() as AddressInfo).port}/graphql`;
    const result = await run(['me'], { home: home.home, apiUrl: url, env: { GLUE_TIMEOUT_MS: '100' } });
    stalled.closeAllConnections();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).message).toContain('timed out');
  });

  it('a change is sent once when the server answers 500', async () => {
    const hits: string[] = [];
    const failing = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(500);
      res.end('<html>down</html>');
    });
    await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(failing.address() as AddressInfo).port}/graphql`;
    const result = await run(['delete-message', 'msg_1', '--yes'], { home: home.home, apiUrl: url });
    await new Promise<void>((resolve) => failing.close(() => resolve()));
    expect(result.code).toBe(1);
    expect(hits).toHaveLength(1);
    expect(result.stderr).not.toContain('<html>');
  });
});

describe('token refresh', () => {
  it('a rejected refresh gives a sign-in error with the next step', async () => {
    const auth = createServer((_, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'TOKEN_EXPIRED' } }));
    });
    await new Promise<void>((resolve) => auth.listen(0, '127.0.0.1', () => resolve()));
    writeFileSync(path.join(home.configDir, 'config.json'), JSON.stringify({ refreshToken: 'r', userId: 'usr_test' }));
    const result = await run(['me'], {
      home: home.home,
      apiUrl: glue.url,
      signedOut: true,
      env: {
        GLUE_ACCESS_TOKEN: 'old',
        GLUE_TOKEN_URL: `http://127.0.0.1:${(auth.address() as AddressInfo).port}/token`,
      },
    });
    await new Promise<void>((resolve) => auth.close(() => resolve()));
    writeFileSync(path.join(home.configDir, 'config.json'), '{}');
    expect(result.code).toBe(1);
    const error = JSON.parse(result.stderr);
    expect(error.message).toContain('TOKEN_EXPIRED');
    expect(error.hint).toContain('glue login --force');
  });
});
