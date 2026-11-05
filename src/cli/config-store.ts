import { getCredentialStore } from '../auth.js';
import { settingsFilePath } from '../paths.js';
import { ACCESS_TOKEN, REFRESH_TOKEN, migrateLegacyConfig } from '../services/migrate.js';
import { loadSettings, updateSettings } from '../settings.js';

/**
 * The values the rest of the code asks for by name. Tokens live in the credential store, and
 * everything else in the settings file. This keeps one call for both, and it is part of the library.
 */
export interface GlueConfig {
  refreshToken?: string;
  accessToken?: string;
  userId?: string;
  firebaseApiKey?: string;
  firebaseAuthDomain?: string;
  firebaseProjectId?: string;
}

export function getConfigPath(): string {
  return settingsFilePath();
}

export function readConfig(): GlueConfig {
  const settings = loadSettings();
  const store = getCredentialStore();
  return {
    refreshToken: store.getApiKey(REFRESH_TOKEN) ?? undefined,
    accessToken: store.getApiKey(ACCESS_TOKEN) ?? undefined,
    userId: settings.userId,
    firebaseApiKey: settings.firebase?.webKey,
    firebaseAuthDomain: settings.firebase?.authDomain,
    firebaseProjectId: settings.firebase?.projectId,
  };
}

export function writeConfig(updates: Partial<GlueConfig>): void {
  migrateLegacyConfig();
  const store = getCredentialStore();
  if (updates.refreshToken) store.setApiKey(REFRESH_TOKEN, updates.refreshToken);
  if (updates.accessToken) store.setApiKey(ACCESS_TOKEN, updates.accessToken);

  const { userId, firebaseApiKey, firebaseAuthDomain, firebaseProjectId } = updates;
  if (userId) updateSettings({ userId });
  if (firebaseApiKey || firebaseAuthDomain || firebaseProjectId) {
    const firebase = { ...loadSettings().firebase };
    if (firebaseApiKey) firebase.webKey = firebaseApiKey;
    if (firebaseAuthDomain) firebase.authDomain = firebaseAuthDomain;
    if (firebaseProjectId) firebase.projectId = firebaseProjectId;
    updateSettings({ firebase });
  }
}

/** Remove the saved sign-in. Environment variables are the caller's own. */
export function clearCredentials(): void {
  const store = getCredentialStore();
  store.deleteApiKey(REFRESH_TOKEN);
  store.deleteApiKey(ACCESS_TOKEN);
  updateSettings({ userId: undefined });
}

/** Resolve a value: environment variable, then what is saved, then the fallback. */
export function resolveToken(envVar: string, configKey: keyof GlueConfig, fallback = ''): string {
  return process.env[envVar] || readConfig()[configKey] || fallback;
}
