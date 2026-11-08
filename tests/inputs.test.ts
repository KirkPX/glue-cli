import { EventEmitter } from 'events';
import { writeFileSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import type { Interface } from 'readline';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ask } from '../src/cli/ask.js';
import { InterruptedError } from '../src/errors.js';
import { ENTRY, run, tempHome } from './helpers/cli.js';
import { FakeGlue, message } from './helpers/fake-glue.js';

describe('Ctrl-C at a prompt', () => {
  it('closes the prompt, which restores typing, and raises InterruptedError', async () => {
    let closed = false;
    const rl = Object.assign(new EventEmitter(), {
      question: () => undefined,
      close: () => {
        closed = true;
      },
    }) as unknown as Interface;
    const pending = ask(rl, 'Sure? ');
    rl.emit('SIGINT');
    await expect(pending).rejects.toBeInstanceOf(InterruptedError);
    expect(closed).toBe(true);
  });
});

const home = tempHome();
const glue = new FakeGlue({
  Thread: (v) => ({ node: { id: v.threadId, subject: 'S', threadType: 'thread', recipients: { edges: [] }, messages: { edges: [] } } }),
  Message: (v) => ({ node: message(v.messageId, 'old', []) }),
  SendMessage: (v) => ({
    sendMessage: { message: message('msg_sent', v.input.message.text), thread: { id: 'thr_one', subject: 's', createdAt: 'x', replyToMessage: null } },
  }),
});
beforeAll(() => glue.start());
afterAll(async () => {
  await glue.stop();
  home.cleanup();
});
beforeEach(() => {
  glue.calls.length = 0;
  writeFileSync(path.join(home.configDir, 'last-sent.json'), 'null');
});

const opts = () => ({ home: home.home, apiUrl: glue.url });
const sent = () => glue.callsTo('SendMessage')[0].variables.input.message.text;

describe('--text-file', () => {
  it('reads the text from a path with a space and non-English characters', async () => {
    const file = path.join(home.home, 'long message é.txt');
    writeFileSync(file, 'He said "hello" to me.\n');
    const result = await run(['send', '--text-file', file, '--thread', 'thr_a', '--yes'], opts());
    expect(result.code).toBe(0);
    expect(sent()).toBe('He said "hello" to me.');
  });

  it('reads the text from standard input with -', async () => {
    const env = { ...process.env, HOME: home.home, USERPROFILE: home.home, GLUE_API_URL: glue.url, GLUE_ACCESS_TOKEN: 't', GLUE_USER_ID: 'usr_t', GLUE_CLI_CREDENTIAL_STORE: 'file', GLUE_CLI_CONFIG_FILE: '', GLUE_CLI_CREDENTIALS_FILE: '' };
    const code = await new Promise<number>((resolve) => {
      const child = execFile(process.execPath, [ENTRY, 'send', '--text-file', '-', '--thread', 'thr_b', '--yes'], { env }, (e) => resolve(e ? 1 : 0));
      child.stdin?.end('from a pipe\n');
    });
    expect(code).toBe(0);
    expect(sent()).toBe('from a pipe');
  });

  it.each([
    [['send', '--thread', 'thr_a', '--yes'], 'No text given'],
    [['send', 'words', '--text-file', 'x.txt', '--thread', 'thr_a', '--yes'], 'not both'],
    [['send', '--text-file', 'no-such-file.txt', '--thread', 'thr_a', '--yes'], 'the file or its folder does not exist'],
  ])('%j says what is wrong and sends nothing', async (args, expected) => {
    const result = await run(args as string[], opts());
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).message).toContain(expected);
    expect(glue.callsTo('SendMessage')).toHaveLength(0);
  });

  it('a folder given to --attach reads as plain words', async () => {
    const result = await run(['send', 'hello', '--thread', 'thr_a', '--attach', home.home, '--yes'], opts());
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).message).toContain('it is a folder');
  });
});

describe('number options', () => {
  it.each([
    ['thread', 'thr_a', '--limit', 'abc'],
    ['thread', 'thr_a', '--limit', '12abc'],
    ['thread', 'thr_a', '--limit', '0'],
    ['threads', '--last', '-1'],
    ['chats', '--last', '1.5'],
    ['drafts', '--last', 'many'],
    ['ai', 'thr_a', 'q', '--wait', 'soon'],
  ])('%s %s refuses a bad number before any request', async (...args) => {
    const result = await run(args, opts());
    expect(result.code).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/invalid|unknown option/i);
    expect(glue.calls).toHaveLength(0);
  });
});

describe('usage errors', () => {
  it('a piped usage error is one JSON object on stderr', async () => {
    const result = await run(['threads', '--last', 'many'], opts());
    expect(result.code).toBeGreaterThan(0);
    const body = JSON.parse(result.stderr.trim());
    expect(body.error).toBe(true);
    expect(body.message).toMatch(/invalid/i);
    expect(body.hint).toMatch(/--help/);
  });

  it('an unknown command is JSON too', async () => {
    const result = await run(['no-such-command', '--json'], opts());
    expect(result.code).toBeGreaterThan(0);
    expect(JSON.parse(result.stderr.trim()).message).toMatch(/no command called/i);
  });

  it('--pretty keeps the plain text', async () => {
    const result = await run(['threads', '--last', 'many', '--pretty'], opts());
    expect(result.stderr).toMatch(/^error: /);
  });
});

describe('GraphQL refusals', () => {
  it('a refusal at HTTP 200 shows the reason and a next step', async () => {
    const empty = new FakeGlue({});
    await empty.start();
    const result = await run(['me'], { home: home.home, apiUrl: empty.url });
    await empty.stop();
    expect(result.code).toBe(1);
    const body = JSON.parse(result.stderr.trim().split('\n').pop()!);
    expect(body.message).toMatch(/no handler/);
    expect(body.hint).toMatch(/reason above/);
  });
});
