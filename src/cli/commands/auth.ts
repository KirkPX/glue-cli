// `glue auth` manages the saved sign-in from a script. People should use `glue login`.
// A token is never taken as an argument, and never printed back in full.

import { getCredentialStoreInfo } from '../../auth.js';
import { config, envSignInVars } from '../../config.js';
import { redact } from '../../errors.js';
import { reporter, type FormatOptions } from '../output.js';
import { logoutCommand } from './login.js';

export type AuthOpts = FormatOptions & { status?: boolean; logout?: boolean };

export async function authCommand(opts: AuthOpts): Promise<void> {
  if (opts.logout && !opts.status) return logoutCommand(opts);

  const refresh = config.glue.refreshToken;
  const access = config.glue.accessToken;
  const store = getCredentialStoreInfo();
  const status = {
    authenticated: Boolean(refresh || access),
    userId: config.glue.userId || null,
    refreshToken: refresh ? redact(refresh) : null,
    accessToken: access ? redact(access) : null,
    setInEnvironment: envSignInVars(),
    credentialStore: store.kind,
    persistent: store.persistent,
  };
  reporter(opts).result(
    status,
    [
      `Authenticated: ${status.authenticated ? 'yes' : 'no'}`,
      `User:          ${status.userId ?? 'unknown'}`,
      `Refresh token: ${status.refreshToken ?? 'none'}`,
      `Store:         ${status.credentialStore} (persistent: ${status.persistent})`,
      ...(status.setInEnvironment.length ? [`Environment:   ${status.setInEnvironment.join(', ')} override the saved sign-in`] : []),
    ].join('\n'),
  );
}
