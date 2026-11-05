import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { credentialsFilePath, getCredentialStore } from '../src/auth.js';
import { configDir, settingsFilePath } from '../src/paths.js';
import { legacyDir } from '../src/services/migrate.js';

const exec = promisify(execFile);
const distIndex = path.resolve(import.meta.dirname, '../dist/index.js');

function expectThrowaway(file: string): void {
  const relative = path.relative(tmpdir(), file);
  expect(relative.startsWith('..') || path.isAbsolute(relative), file).toBe(false);
}

const lastLine = (text: string) => text.trim().split('\n').pop() as string;

// Tests sign in, sign out and save settings. Run against the real home folder, they wipe a real sign-in.
describe('tests cannot touch real things', () => {
  it('the home folder and every file path are throwaway', () => {
    for (const file of [homedir(), configDir(), settingsFilePath(), credentialsFilePath(), legacyDir()]) {
      expectThrowaway(file);
    }
  });

  it('a new process gets the same throwaway home folder', async () => {
    const { stdout } = await exec(process.execPath, ['-p', 'require("node:os").homedir()']);
    expect(stdout.trim()).toBe(homedir());
  });

  it("the built CLI's default settings path is throwaway too", async () => {
    const { stdout } = await exec(process.execPath, [distIndex, '--json', 'config', 'path'], {
      env: { ...process.env, GLUE_CLI_CONFIG_FILE: '' },
    });
    expectThrowaway(JSON.parse(stdout).path);
  });

  it('tokens go to the memory store, not the keychain', () => {
    expect(getCredentialStore().kind).toBe('memory');
  });

  it('a browser cannot open', () => {
    expect(process.env.GLUE_NO_BROWSER).toBe('1');
  });

  it('a call to a real service is refused', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow('real service');
  });

  it('the built CLI sends its GraphQL requests to a closed local port', async () => {
    const failed = await exec(process.execPath, [distIndex, '--json', 'me'], {
      env: { ...process.env, GLUE_ACCESS_TOKEN: 'test', GLUE_USER_ID: 'usr_test' },
    }).catch((e: { code: number; stderr: string }) => e);
    expect((failed as { code: number }).code).toBe(1);
    expect(JSON.parse(lastLine((failed as { stderr: string }).stderr)).message).toContain('could not reach 127.0.0.1:9');
  });

  it('the built CLI sends token renewal to a closed local port', async () => {
    const failed = await exec(process.execPath, [distIndex, '--json', 'me'], {
      env: { ...process.env, GLUE_REFRESH_TOKEN: 'test', GLUE_USER_ID: 'usr_test' },
    }).catch((e: { code: number; stderr: string }) => e);
    expect((failed as { code: number }).code).toBe(1);
    expect(JSON.parse(lastLine((failed as { stderr: string }).stderr)).message).toContain('could not reach 127.0.0.1:9');
  });

  it('the chat service address is a closed local port', () => {
    expect(process.env.GLUE_STREAM_URL).toBe('http://127.0.0.1:9');
  });
});
