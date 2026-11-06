import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { findOpener, openBrowser } from '../src/login/browser.js';
import { FIREBASE_VERSION, loginPage } from '../src/login/page.js';
import { runBrowserLogin } from '../src/login/server.js';
import { ENTRY, run, tempHome } from './helpers/cli.js';
import { FakeGlue } from './helpers/fake-glue.js';

describe('login page', () => {
  it('embeds the nonce, and a nonce cannot end the script', () => {
    expect(loginPage({ nonce: 'abc-123' })).toContain('"abc-123"');
    expect(loginPage({ nonce: '</script>' })).not.toContain('</script>"');
  });

  it('loads only the pinned Firebase library', () => {
    const scripts = [...loginPage({ nonce: 'n' }).matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(2);
    expect(FIREBASE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const src of scripts) {
      expect(src.startsWith(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`)).toBe(true);
    }
  });

  it('puts sign-in text in as text, not HTML', () => {
    const page = loginPage({ nonce: 'n' });
    expect(page).not.toMatch(/innerHTML = [^;]*\b(email|msg)\b/);
  });
});

describe('findOpener', () => {
  it('uses the empty-title form on Windows', () => {
    expect(findOpener('win32', { ComSpec: 'cmd.exe' })).toEqual({ command: 'cmd.exe', args: ['/c', 'start', ''] });
  });
  it('returns null when no opener exists', () => {
    expect(findOpener('darwin', {}, () => false)).toBeNull();
    expect(findOpener('linux', { PATH: '/nowhere' }, () => false)).toBeNull();
  });
});

describe('openBrowser', () => {
  it('launches nothing when the no-browser guard is set', () => {
    expect(openBrowser('http://127.0.0.1:9/never')).toBe(false);
  });
});

describe('runBrowserLogin', () => {
  afterEach(() => vi.restoreAllMocks());

  async function drive(accept: (c: string) => Promise<unknown>) {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = runBrowserLogin({ accept: accept as never, timeoutMs: 10_000 });
    let base = '';
    for (let i = 0; i < 200 && !base; i++) {
      const match = /http:\/\/localhost:(\d+)/.exec(spy.mock.calls.flat().join(' '));
      if (match) base = `http://127.0.0.1:${match[1]}`;
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const html = await (await fetch(base)).text();
    const nonce = /var NONCE = "([^"]+)"/.exec(html)![1];
    return { pending, base, nonce };
  }

  const post = (base: string, body: unknown) =>
    fetch(`${base}/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('refuses a post with the wrong nonce', async () => {
    const accept = vi.fn().mockResolvedValue({ ok: true });
    const { pending, base, nonce } = await drive(accept);
    expect((await post(base, { credential: 'attacker', nonce: 'wrong' })).status).toBe(403);
    expect(accept).not.toHaveBeenCalled();
    expect((await post(base, { credential: 'c', nonce })).status).toBe(200);
    await pending;
  });

  it('keeps listening after a rejected token', async () => {
    const accept = vi.fn().mockRejectedValueOnce(new Error('bad')).mockResolvedValueOnce({ ok: true });
    const { pending, base, nonce } = await drive(accept);
    expect((await post(base, { credential: 'bad', nonce })).status).toBe(400);
    expect((await post(base, { credential: 'good', nonce })).status).toBe(200);
    await pending;
  });

  it('sends no wildcard CORS header', async () => {
    const accept = vi.fn().mockResolvedValue({ ok: true });
    const { pending, base, nonce } = await drive(accept);
    const res = await fetch(base);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    await post(base, { credential: 'c', nonce });
    await pending;
  });
});

describe('login through the built CLI', () => {
  const home = tempHome();
  const glue = new FakeGlue({
    Me: () => ({ me: { __typename: 'User', id: 'usr_derived', name: 'New Person', avatarURL: null, bio: null, profile: null } }),
  });
  let auth: Server;
  let tokenUrl = '';
  let authBase = '';
  const authCalls: Array<{ path: string; body: any }> = [];
  /** How the fake Glue answers a request for an emailed code. */
  let startAnswer: { status: number; body: unknown } = { status: 200, body: { authType: 'email' } };
  const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64')}.s`;

  beforeAll(async () => {
    await glue.start();
    auth = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const route = new URL(req.url ?? '/', 'http://x').pathname;
        if (route !== '/token') {
          const body = JSON.parse(raw);
          authCalls.push({ path: route, body });
          const answer =
            route === '/auth/start' ? startAnswer
            : route === '/auth/verify'
              ? body.code === 'ABC123'
                ? { status: 200, body: { token: 'custom-token' } }
                : { status: 400, body: { code: 400, error: 'bad_request', reason: 'invalid_code' } }
            : route === '/identity' && body.token === 'custom-token'
              ? { status: 200, body: { idToken: jwt, refreshToken: 'good-token' } }
              : { status: 400, body: { error: { message: 'INVALID_CUSTOM_TOKEN' } } };
          res.writeHead(answer.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(answer.body));
          return;
        }
        const good = raw.includes('refresh_token=good-token');
        res.writeHead(good ? 200 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify(good ? { id_token: jwt, expires_in: '3600', refresh_token: 'good-token' } : { error: { message: 'INVALID_REFRESH_TOKEN' } }));
      });
    });
    await new Promise<void>((resolve) => auth.listen(0, '127.0.0.1', () => resolve()));
    authBase = `http://127.0.0.1:${(auth.address() as AddressInfo).port}`;
    tokenUrl = `${authBase}/token`;
  });
  afterAll(async () => {
    await glue.stop();
    await new Promise<void>((resolve) => auth.close(() => resolve()));
    home.cleanup();
  });

  /** Runs `login --paste` with the token on stdin, as a script would. */
  const paste = (token: string, env: Record<string, string> = {}) => cli(['login', '--paste'], token, env);

  /** Runs the built CLI with `input` on stdin. */
  const cli = (args: string[], input: string, env: Record<string, string> = {}) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(
        process.execPath,
        [ENTRY, ...args],
        {
          env: {
            ...process.env,
            HOME: home.home,
            USERPROFILE: home.home,
            APPDATA: path.join(home.home, 'AppData'),
            XDG_CONFIG_HOME: path.join(home.home, '.config'),
            GLUE_NO_BROWSER: '1',
            GLUE_CLI_CREDENTIAL_STORE: 'file',
            GLUE_CLI_CONFIG_FILE: '',
            GLUE_CLI_CREDENTIALS_FILE: '',
            GLUE_TOKEN_URL: tokenUrl,
            GLUE_API_URL: glue.url,
            GLUE_AUTH_URL: authBase,
            GLUE_IDENTITY_URL: `${authBase}/identity`,
            ...env,
          },
        },
        (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr }),
      );
      child.stdin?.end(input);
    });

  const saved = () => path.join(home.configDir, 'credentials.json');
  const signOut = () => run(['logout'], { home: home.home, signedOut: true });
  /** The error is the JSON after any progress lines. */
  const failure = (stderr: string) => JSON.parse(stderr.slice(stderr.indexOf('{')));

  it('--email signs in with the emailed code, typed with spaces and in lower case', async () => {
    await signOut();
    authCalls.length = 0;
    const result = await cli(['login', '--email', 'person@example.com'], 'ab c123\n');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedIn: true, id: 'usr_derived' });
    expect(result.stderr).toContain('sent a sign-in code to person@example.com');
    expect(authCalls.map((c) => c.path)).toEqual(['/auth/start', '/auth/verify', '/identity']);
    expect(authCalls[0].body).toEqual({ address: 'person@example.com' });
    expect(authCalls[1].body).toEqual({ address: 'person@example.com', code: 'ABC123' });
    expect(readFileSync(saved(), 'utf8')).toContain('good-token');
    expect(result.stdout + result.stderr).not.toMatch(/good-token|custom-token/);
  });

  it('--email with no address asks for it first', async () => {
    await signOut();
    authCalls.length = 0;
    const result = await cli(['login', '--email'], 'person@example.com\nABC123\n');
    expect(result.code).toBe(0);
    expect(authCalls[0].body).toEqual({ address: 'person@example.com' });
  });

  it('a wrong code saves nothing and says why', async () => {
    await signOut();
    const result = await cli(['login', '--email', 'person@example.com'], 'ZZZ999\n');
    expect(result.code).toBe(1);
    expect(failure(result.stderr).message).toContain('invalid code');
    expect(existsSync(saved())).toBe(false);
  });

  it('a code that is not 6 characters is refused before Glue sees it', async () => {
    await signOut();
    authCalls.length = 0;
    const result = await cli(['login', '--email', 'person@example.com'], '12\n');
    expect(result.code).toBe(1);
    expect(authCalls.map((c) => c.path)).toEqual(['/auth/start']);
  });

  it('no code on input ends with a reason, not a hang', async () => {
    await signOut();
    const result = await cli(['login', '--email', 'person@example.com'], '');
    expect(result.code).toBe(1);
    expect(failure(result.stderr).message).toContain('No answer');
  });

  it('a bad address is refused before any email is sent', async () => {
    authCalls.length = 0;
    const result = await cli(['login', '--email', 'not-an-address'], '');
    expect(result.code).toBe(1);
    expect(failure(result.stderr).message).toContain('not an email address');
    expect(authCalls).toHaveLength(0);
  });

  it('a workspace on company sign-in is told to use the browser, and no code is asked for', async () => {
    await signOut();
    authCalls.length = 0;
    startAnswer = { status: 200, body: { authType: 'sso', authUrl: 'https://sso.example.com' } };
    try {
      const result = await cli(['login', '--email', 'person@example.com'], 'ABC123\n');
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr).message).toContain('company login');
      expect(authCalls.map((c) => c.path)).toEqual(['/auth/start']);
    } finally {
      startAnswer = { status: 200, body: { authType: 'email' } };
    }
  });

  it('a sign-in Glue does not know points to --email', async () => {
    const denied = createServer((_, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => denied.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(denied.address() as AddressInfo).port}/graphql`;
    const result = await paste('good-token', { GLUE_API_URL: url });
    await new Promise<void>((resolve) => denied.close(() => resolve()));
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).hint).toContain('glue login --email');
  });

  it('a token with no user ID is an unfinished sign-in, so plain login signs in again', async () => {
    await signOut();
    const result = await cli(['login'], 'good-token', { GLUE_REFRESH_TOKEN: 'left-over' });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedIn: true, id: 'usr_derived' });
  });

  it('a bad token saves nothing and keeps the reason', async () => {
    await signOut();
    const result = await paste('bad-token');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).message).toContain('INVALID_REFRESH_TOKEN');
    expect(existsSync(path.join(home.configDir, 'credentials.json'))).toBe(false);
  });

  it('a good token is verified, saved, and the user ID worked out from it', async () => {
    const result = await paste('good-token');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedIn: true, id: 'usr_derived' });
    expect(readFileSync(path.join(home.configDir, 'credentials.json'), 'utf8')).toContain('good-token');
    expect(JSON.parse(readFileSync(path.join(home.configDir, 'config.json'), 'utf8')).userId).toBe('usr_derived');
    expect(result.stdout + result.stderr).not.toContain('good-token');
  });

  it('a stale GLUE_ variable cannot fail a good sign-in, and is named in a warning', async () => {
    const result = await paste('good-token', { GLUE_ACCESS_TOKEN: 'stale' });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('GLUE_ACCESS_TOKEN');
  });

  it('--token is refused, with the safe way to do it', async () => {
    const result = await run(['login', '--token', 'secret-value'], { home: home.home });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).hint).toContain('--paste');
    expect(result.stderr).not.toContain('secret-value');
  });

  it('logout clears the sign-in and the user ID', async () => {
    await paste('good-token');
    const result = await run(['logout'], { home: home.home, signedOut: true });
    expect(JSON.parse(result.stdout).cleared).toBe(true);
    expect(existsSync(path.join(home.configDir, 'credentials.json'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(home.configDir, 'config.json'), 'utf8')).userId).toBeUndefined();
  });

  it('a 401 names the GLUE_ variable when one is set', async () => {
    const denied = createServer((_, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => denied.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(denied.address() as AddressInfo).port}/graphql`;
    const result = await run(['me'], { home: home.home, apiUrl: url });
    await new Promise<void>((resolve) => denied.close(() => resolve()));
    expect(JSON.parse(result.stderr).hint).toContain('GLUE_ACCESS_TOKEN');
  });
});

describe('doctor and auth through the built CLI', () => {
  const home = tempHome();
  afterAll(() => home.cleanup());

  const unset = { GLUE_FIREBASE_API_KEY: '', GLUE_FIREBASE_AUTH_DOMAIN: '', GLUE_FIREBASE_PROJECT_ID: '' };

  it('with no sign-in settings, login says what to set and not where to find it', async () => {
    const { code, stderr } = await run(['login', '--force', '--paste'], { home: home.home, signedOut: true, env: unset });
    expect(code).toBe(1);
    const error = JSON.parse(stderr);
    expect(error.message).toContain('sign-in settings');
    expect(error.hint).toContain('GLUE_FIREBASE_API_KEY');
    expect(error.hint.toLowerCase()).not.toMatch(/web app|bundle|devtools|browser|network tab/);
  });

  it('with no chat setting, a command that needs it says what to set, and others still work', async () => {
    const needs = await run(['thread-activity', 'thr_1'], { home: home.home, env: { GLUE_STREAM_KEY: '' } });
    expect(needs.code).toBe(1);
    const error = JSON.parse(needs.stderr);
    expect(error.message).toContain('chat setting');
    expect(error.hint).toContain('GLUE_STREAM_KEY');
    const other = await run(['doctor'], { home: home.home, env: { GLUE_STREAM_KEY: '' } });
    expect(JSON.parse(other.stdout).checks.find((c: { name: string }) => c.name === 'Chat setting').ok).toBe(false);
  });

  it('doctor reports whether the sign-in settings are set, and never the values', async () => {
    const missing = await run(['doctor'], { home: home.home, signedOut: true, env: unset });
    expect(JSON.parse(missing.stdout).checks.find((c: { name: string }) => c.name === 'Sign-in settings').ok).toBe(false);
    const present = await run(['doctor'], { home: home.home, signedOut: true });
    expect(JSON.parse(present.stdout).checks.find((c: { name: string }) => c.name === 'Sign-in settings').value).toBe('set');
    expect(present.stdout).not.toContain('test-web-key');
  });

  it('doctor reports its checks, never a token, and names a GLUE_ override', async () => {
    const { stdout, code } = await run(['doctor'], { home: home.home });
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    const names = parsed.checks.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Node.js', 'Platform', 'Config file', 'Base URL', 'Sign-in', 'Credential store']));
    expect(stdout).not.toContain('test-access-token');
    expect(parsed.checks.find((c: { name: string }) => c.name === 'Sign-in').value).toContain('GLUE_ACCESS_TOKEN');
  });

  it('doctor survives a broken settings file and reports it', async () => {
    writeFileSync(path.join(home.configDir, 'config.json'), '{ not json');
    const { stdout, code } = await run(['doctor'], { home: home.home, signedOut: true });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).checks.find((c: { name: string }) => c.name === 'Config file').ok).toBe(false);
    writeFileSync(path.join(home.configDir, 'config.json'), '{}');
  });

  it('auth shows only a masked token', async () => {
    const { stdout } = await run(['auth'], { home: home.home });
    const parsed = JSON.parse(stdout);
    expect(parsed.authenticated).toBe(true);
    expect(stdout).not.toContain('test-access-token');
  });

  it('bare glue, signed in, shows help', async () => {
    const { stdout } = await run([], { home: home.home });
    expect(stdout).toContain('Usage: glue');
  });
});
