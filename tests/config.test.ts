import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir } from '../src/paths.js';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue } from './helpers/fake-glue.js';

describe('configDir', () => {
  it('uses XDG_CONFIG_HOME, then ~/.config, off Windows', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/x' }, 'darwin', '/h')).toBe(path.join('/x', 'glue'));
    expect(configDir({}, 'linux', '/h')).toBe(path.join('/h', '.config', 'glue'));
  });
  it('uses APPDATA on Windows', () => {
    expect(configDir({ APPDATA: 'C:\\A' }, 'win32', 'C:\\h')).toBe(path.join('C:\\A', 'glue'));
  });
});

let home: ReturnType<typeof tempHome>;
beforeEach(() => {
  home = tempHome();
});
afterEach(() => home.cleanup());

const glue = () =>
  new FakeGlue({
    Me: () => ({ me: { __typename: 'User', id: 'usr_saved', name: 'Saved', avatarURL: null, bio: null, profile: null } }),
  }).start();

// A token that is good for an hour, so no refresh is attempted.
const liveToken = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64')}.s`;

describe('moving tokens out of an old config file', () => {
  const legacy = { refreshToken: 'old-refresh', accessToken: liveToken, userId: 'usr_saved' };

  it('keeps the sign-in working with no new login, and leaves no token in the settings file', async () => {
    const server = await glue();
    const file = path.join(home.configDir, 'config.json');
    writeFileSync(file, JSON.stringify(legacy));
    const result = await run(['me'], { home: home.home, apiUrl: server.url, signedOut: true });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).id).toBe('usr_saved');
    expect(server.calls[0].authorization).toBe(`Bearer ${liveToken}`);

    const settings = readFileSync(file, 'utf8');
    expect(settings).not.toContain('old-refresh');
    expect(JSON.parse(settings)).toEqual({ userId: 'usr_saved' });

    const credentials = path.join(home.configDir, 'credentials.json');
    expect(readFileSync(credentials, 'utf8')).toContain('old-refresh');
    if (process.platform !== 'win32') expect(statSync(credentials).mode & 0o777).toBe(0o600);

    // The second run reads from the store.
    const second = await run(['me'], { home: home.home, apiUrl: server.url, signedOut: true });
    expect(second.code).toBe(0);
    await server.stop();
  });

  it('memory mode never takes tokens out of a real file', async () => {
    const file = path.join(home.configDir, 'config.json');
    writeFileSync(file, JSON.stringify(legacy));
    await run(['tone'], { home: home.home, env: { GLUE_CLI_CREDENTIAL_STORE: 'memory' } });
    expect(readFileSync(file, 'utf8')).toContain('old-refresh');
  });

  it.each(['GLUE_CLI_CREDENTIALS_FILE', 'GLUE_CLI_CONFIG_FILE'])(
    'a run with %s set leaves the sign-in in the normal folder alone',
    async (name) => {
      const file = path.join(home.configDir, 'config.json');
      const before = JSON.stringify(legacy);
      writeFileSync(file, before);
      const elsewhere = path.join(home.home, 'throwaway', 'target.json');
      await run(['tone'], { home: home.home, env: { [name]: elsewhere } });
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(existsSync(path.join(home.configDir, 'credentials.json'))).toBe(false);
    },
  );

  it('moves old Firebase overrides to their new names', async () => {
    const file = path.join(home.configDir, 'config.json');
    writeFileSync(file, JSON.stringify({ firebaseApiKey: 'web', firebaseProjectId: 'p' }));
    const result = await run(['config', 'show'], { home: home.home });
    expect(JSON.parse(result.stdout).settings).toEqual({ firebase: { webKey: 'web', projectId: 'p' } });
  });

  it('a token written back by an older version moves again', async () => {
    const server = await glue();
    const file = path.join(home.configDir, 'config.json');
    writeFileSync(file, JSON.stringify(legacy));
    await run(['me'], { home: home.home, apiUrl: server.url, signedOut: true });
    writeFileSync(file, JSON.stringify({ ...legacy, refreshToken: 'newer-refresh' }));
    await run(['me'], { home: home.home, apiUrl: server.url, signedOut: true });
    expect(readFileSync(file, 'utf8')).not.toContain('newer-refresh');
    expect(readFileSync(path.join(home.configDir, 'credentials.json'), 'utf8')).toContain('newer-refresh');
    await server.stop();
  });

  it('the tone file stays where it was on macOS and Linux', async () => {
    if (process.platform === 'win32') return;
    writeFileSync(path.join(home.configDir, 'tone.md'), 'Write plainly.\n');
    const result = await run(['tone'], { home: home.home });
    expect(JSON.parse(result.stdout)).toMatchObject({ configured: true, text: 'Write plainly.\n' });
  });

  it('with the folder moved, copies the old files once and keeps newer ones', async () => {
    const elsewhere = path.join(home.home, 'xdg with spaces');
    const legacyDir = path.join(home.home, '.config', 'glue');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(path.join(legacyDir, 'tone.md'), 'old-folder');
    const env: Record<string, string> = process.platform === 'win32' ? { APPDATA: elsewhere } : { XDG_CONFIG_HOME: elsewhere };
    const first = await run(['tone'], { home: home.home, env });
    expect(JSON.parse(first.stdout).text).toBe('old-folder');
    expect(existsSync(path.join(elsewhere, 'glue', 'tone.md'))).toBe(true);
  });
});

describe('settings file', () => {
  it('stops a command on an unknown key, because a misspelt readOnly must not allow writes', async () => {
    writeFileSync(path.join(home.configDir, 'config.json'), JSON.stringify({ readonly: true }));
    const result = await run(['me'], { home: home.home });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).message).toContain('Invalid settings');
  });

  it('config path and config show report the file', async () => {
    const pathResult = await run(['config', 'path'], { home: home.home });
    expect(JSON.parse(pathResult.stdout).path).toBe(path.join(home.configDir, 'config.json'));
    writeFileSync(path.join(home.configDir, 'config.json'), JSON.stringify({ timeoutMs: 5000 }));
    const show = await run(['config', 'show'], { home: home.home });
    expect(JSON.parse(show.stdout).settings).toEqual({ timeoutMs: 5000 });
  });

  it('GLUE_CLI_CONFIG_FILE points at another file, and the environment beats the file', async () => {
    const other = path.join(home.home, 'other settings.json');
    const server = await glue();
    writeFileSync(other, JSON.stringify({ baseUrl: 'http://127.0.0.1:9/graphql' }));
    const result = await run(['me'], { home: home.home, apiUrl: server.url, env: { GLUE_CLI_CONFIG_FILE: other } });
    expect(result.code).toBe(0);
    await server.stop();
  });
});
