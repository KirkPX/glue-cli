// Sign in with a code that Glue emails to the person, the way Glue's own app offers "sign in
// with email". It needs no browser, so it also works over SSH and on locked-down machines.
//
// The steps match Glue's app: ask Glue to email a code, send the code back, and Glue answers
// with a one-time sign-in that Firebase exchanges for the usual refresh token.

import { createInterface, type Interface } from 'node:readline';
import { request, extractSafeDetail } from '../client.js';
import { config, requireRenewalSetting } from '../config.js';
import { InterruptedError, LoginError, UsageError, safeErrorMessage } from '../errors.js';

const IDENTITY_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';

/** Glue's sign-in requests live beside its GraphQL endpoint. */
function authBase(): string {
  return process.env.GLUE_AUTH_URL || new URL(config.glue.apiUrl).origin;
}

/** A code is six letters or digits. People often type it with spaces, as the email shows it. */
export function normaliseCode(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function looksLikeEmail(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

/** Runs the email sign-in and returns a refresh token, which the caller proves and saves. */
export async function emailLogin(address?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY === true });
  const lines = lineReader(rl);
  try {
    const email = (address ?? (await lines('Your Glue email address: '))).trim();
    if (!looksLikeEmail(email)) {
      throw new UsageError(`"${email}" is not an email address.`, 'Run `glue login --email you@example.com`.');
    }

    await startEmailSignIn(email);
    console.error(`Glue sent a sign-in code to ${email}. It can take a minute to arrive.`);

    const code = normaliseCode(await lines('Code from the email: '));
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      throw new LoginError('The code must be the 6 characters from the email.', 'Run `glue login --email` again for a new code.');
    }

    const customToken = await verifyCode(email, code);
    return await exchangeCustomToken(customToken);
  } finally {
    rl.close();
  }
}

async function startEmailSignIn(email: string): Promise<void> {
  // No retry: each attempt sends another email.
  const response = await request(
    `${authBase()}/auth/start`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: email }) },
    { operation: 'Email sign-in', retry: 'none' },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new LoginError(`Glue would not send a sign-in code: ${reason(body)}`, 'Check the address is the one you use for Glue.');
  }
  let data: { authType?: string } = {};
  try {
    data = JSON.parse(body);
  } catch {
    // An empty answer still means the email went out.
  }
  if (data.authType === 'sso') {
    throw new LoginError(
      'Your Glue workspace signs in through your company login, which `glue login --email` cannot do.',
      'Run `glue login` and sign in with the same account you use for Glue.',
    );
  }
}

async function verifyCode(email: string, code: string): Promise<string> {
  const response = await request(
    `${authBase()}/auth/verify`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: email, code }) },
    { operation: 'Email sign-in', retry: 'none' },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new LoginError(`Glue did not accept the code: ${reason(body)}`, 'Check the code, or run `glue login --email` again for a new one.');
  }
  const token = (JSON.parse(body) as { token?: unknown }).token;
  if (typeof token !== 'string' || !token) {
    throw new LoginError('Glue accepted the code but sent no sign-in.', 'Run `glue login --email` again.');
  }
  return token;
}

async function exchangeCustomToken(customToken: string): Promise<string> {
  const key = requireRenewalSetting();
  const base = process.env.GLUE_IDENTITY_URL || IDENTITY_URL;
  const response = await request(
    `${base}?key=${encodeURIComponent(key)}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
    { operation: 'Email sign-in', retry: 'none' },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new LoginError(`Could not finish the sign-in: ${extractSafeDetail(body)}`, 'Check the sign-in settings with `glue doctor`.');
  }
  const refreshToken = (JSON.parse(body) as { refreshToken?: unknown }).refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new LoginError('The sign-in finished without a token.', 'Run `glue login --email` again.');
  }
  return refreshToken;
}

/** Glue answers sign-in errors as { reason } or { error }, in snake case. Show it as words. */
function reason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { reason?: unknown; error?: unknown };
    const text = [parsed.reason, parsed.error].find((v) => typeof v === 'string' && v && v !== 'unknown');
    if (typeof text === 'string') return safeErrorMessage(text.replace(/_/g, ' '));
  } catch {
    // Not JSON: the general reader says what it can.
  }
  return extractSafeDetail(body);
}

/** One reader for every question, so piped answers are read in order. Ends cleanly on end of input. */
function lineReader(rl: Interface): (question: string) => Promise<string> {
  const queued: string[] = [];
  const waiting: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  let closed = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next) next.resolve(line);
    else queued.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const w of waiting.splice(0)) w.reject(new LoginError('No answer was entered.', 'Run `glue login --email` again.'));
  });
  rl.on('SIGINT', () => {
    for (const w of waiting.splice(0)) w.reject(new InterruptedError());
    rl.close();
  });
  return (question) => {
    if (queued.length) return Promise.resolve(queued.shift()!);
    if (closed) return Promise.reject(new LoginError('No answer was entered.', 'Run `glue login --email` again.'));
    process.stderr.write(question);
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
}
