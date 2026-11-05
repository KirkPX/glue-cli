import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// A throwaway home folder for this run. Removed when the run ends.
const scratch = join(tmpdir(), `glue-cli-test-${process.pid}`);
mkdirSync(scratch, { recursive: true });
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

// A closed local port, so a built CLI that makes a request fails at once and never reaches a real
// service. Every address the CLI can call is listed here.
const closed = 'http://127.0.0.1:9';

export default defineConfig({
  test: {
    // Checks the settings below before each test file, and refuses real network calls.
    setupFiles: ['./tests/setup.ts'],
    // os.homedir() reads the process's real environment. A worker thread has only a copy, so the
    // throwaway home folder needs one process per worker.
    pool: 'forks',
    testTimeout: 30_000,
    env: {
      GLUE_NO_BROWSER: '1',
      // Tests, and the processes they start, must never read or write the real home folder,
      // credentials or settings.
      HOME: scratch,
      USERPROFILE: scratch,
      APPDATA: join(scratch, 'AppData', 'Roaming'),
      XDG_CONFIG_HOME: join(scratch, '.config'),
      GLUE_CLI_CREDENTIAL_STORE: 'memory',
      GLUE_CLI_CONFIG_FILE: join(scratch, 'config.json'),
      GLUE_CLI_CREDENTIALS_FILE: join(scratch, 'credentials.json'),
      GLUE_API_URL: `${closed}/graphql`,
      GLUE_TOKEN_URL: `${closed}/token`,
      GLUE_STREAM_URL: closed,
      GLUE_FIREBASE_API_KEY: 'test-web-key',
      GLUE_FIREBASE_AUTH_DOMAIN: 'test.invalid',
      GLUE_FIREBASE_PROJECT_ID: 'test-project',
      GLUE_STREAM_KEY: 'test-chat-key',
      // A value exported in the developer's shell must not change test results.
      GLUE_ACCESS_TOKEN: '',
      GLUE_REFRESH_TOKEN: '',
      GLUE_USER_ID: '',
      GLUE_READ_ONLY: '',
      GLUE_TIMEOUT_MS: '',
    },
  },
});
