import { execFile } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/** The file a user runs. Every behaviour test goes through it, so option wiring is tested too. */
export const ENTRY = path.resolve(import.meta.dirname, '../../', JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8'),
).bin.glue);

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A throwaway home folder. Its name has a space and non-English characters on purpose. */
export function tempHome(): { home: string; configDir: string; cleanup(): void } {
  const home = mkdtempSync(path.join(tmpdir(), 'glue tést 日本語 '));
  const configDir =
    process.platform === 'win32' ? path.join(home, 'AppData', 'glue') : path.join(home, '.config', 'glue');
  mkdirSync(configDir, { recursive: true });
  return {
    home,
    configDir,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

export interface RunOptions {
  home: string;
  apiUrl?: string;
  env?: Record<string, string>;
  /** Leave the sign-in out, to test what happens with no credentials. */
  signedOut?: boolean;
}

/** Runs the built CLI with a clean environment: it cannot see the developer's sign-in. */
export function run(args: string[], options: RunOptions): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GLUE_')) env[key] = value;
  }
  Object.assign(env, {
    HOME: options.home,
    USERPROFILE: options.home,
    APPDATA: path.join(options.home, 'AppData'),
    XDG_CONFIG_HOME: path.join(options.home, '.config'),
    GLUE_NO_BROWSER: '1',
    GLUE_CLI_CREDENTIAL_STORE: 'file',
    GLUE_FIREBASE_API_KEY: 'test-web-key',
    GLUE_STREAM_KEY: 'test-chat-key',
    GLUE_FIREBASE_AUTH_DOMAIN: 'test.invalid',
    GLUE_FIREBASE_PROJECT_ID: 'test-project',
    GLUE_API_URL: options.apiUrl ?? 'http://127.0.0.1:9/graphql',
    GLUE_TOKEN_URL: 'http://127.0.0.1:9/token',
    GLUE_STREAM_URL: 'http://127.0.0.1:9',
  });
  if (!options.signedOut) {
    env.GLUE_ACCESS_TOKEN = 'test-access-token';
    env.GLUE_USER_ID = 'usr_test';
  }
  Object.assign(env, options.env);

  return new Promise((resolve) => {
    const child = execFile(process.execPath, [ENTRY, ...args], { env }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
    child.stdin?.end();
  });
}
