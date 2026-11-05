import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileCredentialStore, getCredentialStore } from '../auth.js';
import { configDir, settingsFilePath } from '../paths.js';

export const REFRESH_TOKEN = 'refreshToken';
export const ACCESS_TOKEN = 'accessToken';

const TOKEN_KEYS = [REFRESH_TOKEN, ACCESS_TOKEN] as const;

/** Where every earlier version kept its files, on every system. */
export function legacyDir(home: string = homedir()): string {
  return join(home, '.config', 'glue');
}

let done = false;

/** Test seam. */
export function resetMigration(): void {
  done = false;
}

/**
 * Earlier versions kept the sign-in tokens in config.json. This moves them to the credential store,
 * with no new sign-in, and leaves only settings behind. It runs on every process and does nothing
 * once the file is clean, so a run of an older version that writes tokens again is also handled.
 *
 * The order matters. Tokens are saved and read back before config.json changes, so a crash at any
 * point leaves a working sign-in, and two processes doing this at once write the same values.
 *
 * The tokens also go to the private file, which is where they already were, in effect. The macOS
 * keychain is closed to SSH sessions, so a move made at the desktop into the keychain alone would
 * sign those sessions out. With the file present, later saves update both places.
 */
export function migrateLegacyConfig(): void {
  if (done) return;
  done = true;
  // Memory mode is for tests and throwaway runs. It must not take tokens out of a real file.
  if (process.env.GLUE_CLI_CREDENTIAL_STORE === 'memory') return;

  // A credentials file named by hand may be a test or a throwaway path. A sign-in moved there would
  // be lost with it, so nothing moves. A settings file named by hand moves only that file, and the
  // normal folder stays as it is.
  if (process.env.GLUE_CLI_CREDENTIALS_FILE) return;
  if (process.env.GLUE_CLI_CONFIG_FILE) {
    migrateFile(settingsFilePath());
    return;
  }

  copyLegacyFiles();
  for (const path of new Set([settingsFilePath(), join(legacyDir(), 'config.json')])) {
    migrateFile(path);
  }
}

/** On Windows, or with XDG_CONFIG_HOME set, the folder moves. Copy what the CLI keeps there. */
function copyLegacyFiles(): void {
  const from = legacyDir();
  const to = configDir();
  if (from === to || !existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name === 'config.json') continue;
    const target = join(to, name);
    if (existsSync(target)) continue;
    if (name === 'undo') cpSync(join(from, name), target, { recursive: true });
    else copyFileSync(join(from, name), target);
  }
}

function migrateFile(path: string): void {
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    raw = parsed;
  } catch {
    return; // Missing or unreadable. The settings reader reports a broken file.
  }

  const legacyKeys = [...TOKEN_KEYS, 'firebaseApiKey', 'firebaseAuthDomain', 'firebaseProjectId'];
  if (!legacyKeys.some((key) => key in raw)) return;

  const store = getCredentialStore();
  const file = new FileCredentialStore();
  for (const key of TOKEN_KEYS) {
    const value = raw[key];
    if (typeof value !== 'string' || !value) continue;
    store.setApiKey(key, value);
    if (store.kind !== 'file') file.setApiKey(key, value);
    if (store.getApiKey(key) !== value && file.getApiKey(key) !== value) return; // Leave config.json alone.
  }

  const { refreshToken: _r, accessToken: _a, firebaseApiKey, firebaseAuthDomain, firebaseProjectId, ...rest } = raw as Record<string, any>;
  const firebase = {
    ...(rest.firebase ?? {}),
    ...(firebaseApiKey ? { webKey: firebaseApiKey } : {}),
    ...(firebaseAuthDomain ? { authDomain: firebaseAuthDomain } : {}),
    ...(firebaseProjectId ? { projectId: firebaseProjectId } : {}),
  };
  const next = Object.keys(firebase).length ? { ...rest, firebase } : rest;

  const target = settingsFilePath();
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, target);
  if (path !== target) {
    const oldTmp = `${path}.${process.pid}.tmp`;
    writeFileSync(oldTmp, '{}\n', { mode: 0o600 });
    renameSync(oldTmp, path);
  }
}
