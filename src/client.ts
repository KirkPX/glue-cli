// The one place this CLI makes an HTTP request. The GraphQL client, token refresh, file upload and
// file download all come through here, so each has an explicit timeout, limited retries that the
// user can see, and errors that hold no credential. GetStream is a vendor library with its own
// transport, so client-realtime.ts applies the same rules through callWithPolicy below.

import { ApiError, NetworkError, TimeoutError, safeErrorMessage } from './errors.js';
import { loadSettings } from './settings.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const TRANSFER_TIMEOUT_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * - `safe`: a read. Retry on 429, 5xx and a failed connection.
 * - `rate-limit`: a change. Retry only on 429, because the server refused it without acting.
 *   A 5xx or a lost connection may mean the change happened, so a retry could apply it twice.
 * - `none`: never retry.
 */
export type RetryMode = 'safe' | 'rate-limit' | 'none';

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
  operation: string;
}

export interface RequestPolicy {
  operation: string;
  retry?: RetryMode;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (info: RetryInfo) => void;
}

export function resolveTimeoutMs(fallback = DEFAULT_TIMEOUT_MS): number {
  const fromEnv = Number(process.env.GLUE_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return loadSettings().timeoutMs ?? fallback;
}

function announceRetry(info: RetryInfo): void {
  console.error(
    `${info.operation}: ${info.reason}. Retrying in ${Math.ceil(info.delayMs / 1000)}s ` +
      `(attempt ${info.attempt + 1} of ${info.maxAttempts}).`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The delay a Retry-After value asks for, in seconds or as a date. Null when absent or unreadable. */
export function retryAfterMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Sends one request under a policy, and returns the response with its body already read, so the
 * timeout also covers a server that stalls partway through the body. A non-2xx response is returned
 * after any retries; the caller decides what it means. A timeout is never retried: the caller has
 * already waited the whole time, and the request may still be running on the server.
 */
export async function request(url: string, init: RequestInit, policy: RequestPolicy): Promise<Response> {
  const mode = policy.retry ?? 'none';
  const maxAttempts = mode === 'none' ? 1 : (policy.maxAttempts ?? MAX_ATTEMPTS);
  const baseDelayMs = policy.baseDelayMs ?? BASE_DELAY_MS;
  const onRetry = policy.onRetry ?? announceRetry;
  const timeoutMs = policy.timeoutMs ?? resolveTimeoutMs();

  for (let attempt = 1; ; attempt++) {
    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await fetchOnce(url, init, policy.operation, timeoutMs);
    } catch (error) {
      if (error instanceof TimeoutError || (error as Error)?.name === 'AbortError') throw error;
      failure = error;
    }

    const status = response?.status;
    const retriable = response
      ? status === 429 ? mode !== 'none' : mode === 'safe' && status! >= 500
      : mode === 'safe';

    if (response && (response.ok || !retriable || attempt >= maxAttempts)) return response;
    if (!response && (!retriable || attempt >= maxAttempts)) {
      throw new NetworkError({ operation: policy.operation, host: new URL(url).host, cause: failure });
    }

    const asked = response ? retryAfterMs(response.headers.get('retry-after')) : null;
    if (asked !== null && asked > MAX_RETRY_AFTER_MS) return response!;
    const delayMs = asked ?? baseDelayMs * attempt;
    onRetry({
      attempt,
      maxAttempts,
      delayMs,
      reason: response ? `server answered ${status}` : 'connection failed',
      operation: policy.operation,
    });
    await sleep(delayMs);
  }
}

async function fetchOnce(url: string, init: RequestInit, operation: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  init.signal?.addEventListener('abort', onCallerAbort);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const noBody = [101, 204, 205, 304].includes(response.status);
    const body = noBody ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (timedOut) {
      throw new TimeoutError({
        operation,
        timeoutMs,
        hint: 'The server did not answer in time. Try again, or raise the limit with GLUE_TIMEOUT_MS.',
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onCallerAbort);
  }
}

/** The message from a JSON error body, cleaned and shortened. Never the raw body. */
export function safeDetail(body: string): string {
  let detail: unknown;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.errors?.[0]?.message ?? parsed?.error?.message ?? parsed?.message ?? parsed?.error;
  } catch {
    // Not JSON: an HTML error page or similar holds nothing a user can act on.
  }
  if (typeof detail !== 'string' || !detail) return 'no response detail';
  const clean = safeErrorMessage(detail);
  return clean.length > 300 ? `${clean.slice(0, 300)}…` : clean;
}

export interface CallPolicy extends RequestPolicy {
  /** The status a vendor error holds, when it has one. */
  statusOf?: (error: unknown) => number | undefined;
  retryAfterOf?: (error: unknown) => string | undefined;
}

/** Applies the timeout and retry rules to a call that does not go through `request`. */
export async function callWithPolicy<T>(call: () => Promise<T>, policy: CallPolicy): Promise<T> {
  const mode = policy.retry ?? 'none';
  const maxAttempts = mode === 'none' ? 1 : (policy.maxAttempts ?? MAX_ATTEMPTS);
  const baseDelayMs = policy.baseDelayMs ?? BASE_DELAY_MS;
  const onRetry = policy.onRetry ?? announceRetry;
  const timeoutMs = policy.timeoutMs ?? resolveTimeoutMs();

  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(call(), policy.operation, timeoutMs);
    } catch (error) {
      if (error instanceof TimeoutError) throw error;
      const status = policy.statusOf?.(error);
      const retriable = status === 429 ? mode !== 'none' : mode === 'safe' && (status === undefined || status >= 500);
      if (!retriable || attempt >= maxAttempts) {
        throw new ApiError({
          status: status ?? 0,
          statusText: status === undefined ? 'no response' : 'error',
          operation: policy.operation,
          safeDetail: safeErrorMessage((error as Error)?.message ?? String(error)),
        });
      }
      const asked = retryAfterMs(policy.retryAfterOf?.(error));
      const delayMs = Math.min(asked ?? baseDelayMs * attempt, MAX_RETRY_AFTER_MS);
      onRetry({
        attempt,
        maxAttempts,
        delayMs,
        reason: status === undefined ? 'connection failed' : `server answered ${status}`,
        operation: policy.operation,
      });
      await sleep(delayMs);
    }
  }
}

function withTimeout<T>(work: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new TimeoutError({
            operation,
            timeoutMs,
            hint: 'The server did not answer in time. Try again, or raise the limit with GLUE_TIMEOUT_MS.',
          }),
        ),
      timeoutMs,
    );
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
