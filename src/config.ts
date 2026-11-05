import { resolveToken } from './cli/config-store.js';
import { ConfigError } from './errors.js';
import { loadSettings } from './settings.js';

export const DEFAULT_API_URL = 'https://api.gluegroups.com/graphql';

/** The sign-in settings in the environment. They beat a saved sign-in, which can hide it. */
export function envSignInVars(): string[] {
  return ['GLUE_ACCESS_TOKEN', 'GLUE_REFRESH_TOKEN', 'GLUE_USER_ID'].filter((name) => process.env[name]);
}

/** The next step after Glue refuses the sign-in. */
export function signInHint(): string {
  const fromEnv = envSignInVars();
  return fromEnv.length
    ? `${fromEnv.join(' and ')} override the saved sign-in, and may be out of date. Unset them, then run \`glue login --force\` if it still fails.`
    : 'Run `glue login --force` to sign in again.';
}

export const config = {
  // Glue API. Precedence: environment variable, then the settings file or credential store, then the default.
  glue: {
    get apiUrl() { return process.env.GLUE_API_URL || loadSettings().baseUrl || DEFAULT_API_URL; },
    get accessToken() { return resolveToken('GLUE_ACCESS_TOKEN', 'accessToken'); },
    get refreshToken() { return resolveToken('GLUE_REFRESH_TOKEN', 'refreshToken'); },
    get userId() { return resolveToken('GLUE_USER_ID', 'userId'); },
  },
  // Required for sign-in and token renewal. The user supplies these. None is built in.
  firebase: {
    get apiKey() { return resolveToken('GLUE_FIREBASE_API_KEY', 'firebaseApiKey'); },
    get authDomain() { return resolveToken('GLUE_FIREBASE_AUTH_DOMAIN', 'firebaseAuthDomain'); },
    get projectId() { return resolveToken('GLUE_FIREBASE_PROJECT_ID', 'firebaseProjectId'); },
  },
};

const SIGN_IN_SETTINGS_HINT =
  'Set `firebase` in the settings file (`glue config path`), or set GLUE_FIREBASE_API_KEY, ' +
  'GLUE_FIREBASE_AUTH_DOMAIN and GLUE_FIREBASE_PROJECT_ID. See docs/configuration.md.';

/** Reactions, quote-replies, watch and thread activity go through the chat service. */
export function requireChatKey(): string {
  const key = process.env.GLUE_STREAM_KEY || loadSettings().streamKey;
  if (!key) {
    throw new ConfigError(
      'The chat setting is not set.',
      'Set `streamKey` in the settings file (`glue config path`), or set GLUE_STREAM_KEY. See docs/configuration.md.',
    );
  }
  return key;
}

/** Signing in needs all three values. */
export function requireSignInSettings(): void {
  const { apiKey, authDomain, projectId } = config.firebase;
  if (!apiKey || !authDomain || !projectId) {
    throw new ConfigError('The sign-in settings are not set.', SIGN_IN_SETTINGS_HINT);
  }
}

/** Renewing a token needs only the key. */
export function requireRenewalSetting(): string {
  const { apiKey } = config.firebase;
  if (!apiKey) throw new ConfigError('The sign-in settings are not set.', SIGN_IN_SETTINGS_HINT);
  return apiKey;
}

// Validate required configuration
export function validateConfig() {
  if ((!config.glue.accessToken && !config.glue.refreshToken) || !config.glue.userId) {
    throw new ConfigError(
      'Not signed in.',
      config.glue.accessToken
        ? 'The user ID is missing. Run `glue login --force`, or set GLUE_USER_ID.'
        : 'Run `glue login`, or set GLUE_REFRESH_TOKEN.',
    );
  }
  if (!config.glue.userId.startsWith('usr_')) {
    throw new ConfigError('GLUE_USER_ID must start with "usr_".', 'Check GLUE_USER_ID, or sign in again with `glue login --force`.');
  }
}
