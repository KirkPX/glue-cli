// `glue login` signs in through the browser, or with --paste in the terminal. It proves the token
// works against Glue before it saves anything, and it works out the user ID from the token.

import { getCredentialStore, storeLabel } from '../../auth.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { config, envSignInVars, requireSignInSettings, signInHint, validateConfig } from '../../config.js';
import { LoginError, UsageError } from '../../errors.js';
import { findOpener } from '../../login/browser.js';
import { promptSecret } from '../../login/prompt.js';
import { runBrowserLogin } from '../../login/server.js';
import { ACCESS_TOKEN, REFRESH_TOKEN } from '../../services/migrate.js';
import { TokenRefreshService } from '../../services/token-refresh.js';
import { clearCredentials, writeConfig } from '../config-store.js';
import { reporter, type FormatOptions, type Reporter } from '../output.js';

export type LoginOpts = FormatOptions & {
  status?: boolean;
  refresh?: boolean;
  token?: string;
  force?: boolean;
  paste?: boolean;
};

type Verified = { loggedIn: true; id: string; name: string; credentialStore: string };

export async function loginCommand(opts: LoginOpts = {}): Promise<void> {
  const r = reporter(opts);

  if (opts.token) {
    throw new UsageError(
      'glue login no longer takes a token as an argument, because that leaves it in your shell history.',
      'Run `glue login --paste` and paste it, pipe it in with `... | glue login --paste`, or set GLUE_REFRESH_TOKEN.',
    );
  }

  if (opts.refresh) {
    if (!config.glue.refreshToken) {
      throw new LoginError('No saved sign-in to refresh.', 'Run `glue login`.');
    }
    await new TokenRefreshService(config.glue.refreshToken, config.glue.accessToken).getValidToken();
    r.result({ refreshed: true }, 'Token refreshed and saved.');
    return;
  }

  if (opts.status) {
    await showStatus(r);
    return;
  }

  // Already signed in: report it. Only --force and --paste sign in again.
  if (!opts.force && !opts.paste && config.glue.refreshToken) {
    await showStatus(r);
    return;
  }

  requireSignInSettings();
  const verified = opts.paste || !canUseBrowser() ? await pasteLogin() : await runBrowserLogin({ accept: verify });
  report(verified, r);
}

export async function logoutCommand(opts: FormatOptions = {}): Promise<void> {
  clearCredentials();
  const overriding = envSignInVars();
  reporter(opts).result(
    { cleared: true, stillSetInEnvironment: overriding },
    'Signed out.' + (overriding.length ? ` ${overriding.join(' and ')} still set, and will be used.` : ''),
  );
}

/** True when a sign-in is on hand, saved or in the environment. */
export function isConfigured(): boolean {
  return Boolean(config.glue.refreshToken || config.glue.accessToken);
}

async function showStatus(r: Reporter): Promise<void> {
  if (!config.glue.refreshToken && !config.glue.accessToken) {
    throw new LoginError('Not signed in.', 'Run `glue login`.');
  }
  validateConfig();

  const service = new TokenRefreshService(config.glue.refreshToken, config.glue.accessToken);
  let me;
  try {
    me = await new GlueAPIClient().getMe();
  } catch (error) {
    throw new LoginError(`Sign-in check failed: ${(error as Error).message}`, signInHint());
  }

  const expired = service.isTokenExpired();
  const overriding = envSignInVars();
  r.result(
    { loggedIn: true, id: me.id, name: me.name, accessTokenExpired: expired, setInEnvironment: overriding },
    [
      `Logged in as: ${me.name} (${me.id})`,
      `Access token: ${expired ? 'expired (will auto-refresh)' : `valid for ${service.getTimeUntilExpirationFormatted()}`}`,
      `Refresh token: ${config.glue.refreshToken ? 'configured (auto-renews indefinitely)' : 'none, so the access token cannot renew'}`,
      ...(overriding.length ? [`From the environment: ${overriding.join(', ')}. These override the saved sign-in.`] : []),
    ].join('\n'),
  );
}

function report(verified: Verified, r: Reporter): void {
  const overriding = envSignInVars();
  if (overriding.length) {
    r.warn(`${overriding.join(' and ')} still set, and will override this sign-in. Unset to use it.`);
  }
  r.result(
    verified,
    `Signed in as ${verified.name} (${verified.id}).\nSaved to your ${verified.credentialStore}.`,
  );
}

async function pasteLogin(): Promise<Verified> {
  const credential = await promptSecret('Paste your Glue refresh token: ');
  return await verify(credential);
}

/**
 * Prove the token works, then save it. Storing first would report a typo as success, and fail later
 * somewhere less obvious. The check uses the new token directly, so an old GLUE_ variable in the
 * environment cannot make a good sign-in look bad.
 */
export async function verify(credential: string): Promise<Verified> {
  const refreshToken = credential.trim();
  if (!refreshToken) throw new LoginError('Nothing entered.');

  const accessToken = await new TokenRefreshService(refreshToken, undefined, { persist: false }).getValidToken();
  const me = await new GlueAPIClient({ accessToken }).getMe();

  writeConfig({ userId: me.id });
  const store = getCredentialStore();
  store.setApiKey(ACCESS_TOKEN, accessToken);
  const savedTo = store.setApiKey(REFRESH_TOKEN, refreshToken) ?? store.kind;
  return { loggedIn: true, id: me.id, name: me.name, credentialStore: storeLabel(savedTo) };
}

function canUseBrowser(): boolean {
  if (process.env.GLUE_NO_BROWSER) return false;
  // Over SSH, a browser would open on a screen nobody is looking at.
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return false;
  return process.stdout.isTTY === true && findOpener() !== null;
}
