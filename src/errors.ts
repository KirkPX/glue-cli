// Typed errors and secret redaction. Every failure in this CLI is one of these, so
// the top-level handler in index.ts formats them the same way. Errors carry the
// operation, the status and a safe detail, and never a token or a credential.

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly operation: string;
  readonly safeDetail: string;
  readonly hint?: string;

  constructor(opts: {
    status: number;
    statusText: string;
    operation: string;
    safeDetail: string;
    hint?: string;
  }) {
    super(`${opts.operation} failed: ${opts.status} ${opts.statusText} — ${opts.safeDetail}`);
    this.name = 'ApiError';
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.operation = opts.operation;
    this.safeDetail = opts.safeDetail;
    this.hint = opts.hint ?? apiErrorHint(opts.status);
  }
}

/** The next step for a refusal, so a person never sees a bare status code. */
export function apiErrorHint(status: number): string | undefined {
  if (status === 401) return 'Glue refused the sign-in. Run `glue login --force`, or check any GLUE_ token variables you set.';
  if (status === 403) return 'The sign-in works, but this account may not be allowed to do this. `glue me` shows which account is in use.';
  if (status === 404) return 'Check the ID. `glue threads`, `glue chats` and `glue people` list the ones you can use.';
  if (status === 400 || status === 422) return 'Glue could not accept the values sent. The reason above says which.';
  if (status === 429) return 'Glue is limiting requests. Wait a minute, then try again.';
  if (status >= 500) return 'Glue had a problem answering. Try again in a few minutes.';
  return undefined;
}

export class TimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;
  readonly hint?: string;

  constructor(opts: { operation: string; timeoutMs: number; hint?: string }) {
    super(`${opts.operation} timed out after ${opts.timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.operation = opts.operation;
    this.timeoutMs = opts.timeoutMs;
    this.hint = opts.hint;
  }
}

/** The request never got an answer: no connection, a name that did not resolve, a bad certificate. */
export class NetworkError extends Error {
  readonly operation: string;
  readonly host: string;
  readonly hint: string;

  constructor(opts: { operation: string; host: string; cause: unknown }) {
    const code = causeCode(opts.cause);
    super(`${opts.operation} could not reach ${opts.host}: ${NETWORK_REASONS[code] ?? 'the connection failed'}.`);
    this.name = 'NetworkError';
    this.operation = opts.operation;
    this.host = opts.host;
    this.hint = 'Check your connection and try again.';
  }
}

const NETWORK_REASONS: Record<string, string> = {
  ENOTFOUND: 'the name did not resolve',
  EAI_AGAIN: 'the name did not resolve',
  ECONNREFUSED: 'the connection was refused',
  ECONNRESET: 'the connection was dropped',
  ETIMEDOUT: 'the connection timed out',
  UND_ERR_CONNECT_TIMEOUT: 'the connection timed out',
  CERT_HAS_EXPIRED: 'its certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'its certificate is not trusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'its certificate is not trusted',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'its certificate is not trusted',
};

// fetch reports every network failure as "fetch failed", with the reason on `cause`.
function causeCode(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code ?? (error as { code?: string })?.code ?? '';
}

/**
 * The CLI is not set up correctly, or was invoked in a way it cannot act on.
 * `hint` is the next step, printed by the top-level handler.
 */
export class ConfigError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'ConfigError';
    this.hint = hint;
  }
}

/** A malformed invocation: a bad flag value, a missing required combination. */
export class UsageError extends ConfigError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = 'UsageError';
  }
}

/** Sign-in could not complete. */
export class LoginError extends ConfigError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = 'LoginError';
  }
}

/** The person pressed Ctrl-C at a prompt. The top-level handler exits 130, as a shell does. */
export class InterruptedError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'InterruptedError';
  }
}

/** A file system failure in plain words, for a message that also names the file. */
export function fileErrorReason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return 'the file or its folder does not exist';
  if (code === 'EISDIR') return 'it is a folder, not a file';
  // Windows reports a file in the way of a folder as EEXIST when making the folder.
  if (code === 'ENOTDIR' || code === 'EEXIST') return 'part of the path is a file, not a folder';
  if (code === 'EACCES' || code === 'EPERM') return 'you do not have permission';
  if (code === 'EROFS') return 'the disk is read-only';
  if (code === 'ENOSPC') return 'the disk is full';
  return code ?? (err instanceof Error ? err.message : 'unknown error');
}

/** Mask the middle of a secret, keeping a few edge characters to identify it. */
export function redact(value: string, show = 4): string {
  if (value.length <= show + 4) return '****';
  return value.slice(0, show) + '****' + value.slice(-show);
}

/** Remove credentials from any text before it is printed. */
export function safeErrorMessage(raw: string): string {
  return raw
    .replace(/(?<=:\/{2})[^@\s/]+@/g, '****@')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ****')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '****')
    .replace(/\b(key|token|access_token|refresh_token|id_token)=[^&\s"']+/gi, '$1=****');
}

/**
 * A GraphQL refusal arrives with HTTP 200, so it has no status. Its `extensions.code` says the same
 * thing a status would, so it gets the same next step.
 */
export function graphqlErrorHint(error: unknown): string | undefined {
  if ((error as { name?: unknown })?.name !== 'CombinedGraphQLErrors') return undefined;
  const errors = (error as { errors?: Array<{ extensions?: { code?: unknown } }> }).errors ?? [];
  const codes = errors.map((e) => String(e?.extensions?.code ?? ''));
  if (codes.includes('UNAUTHENTICATED')) return apiErrorHint(401);
  if (codes.includes('FORBIDDEN')) return apiErrorHint(403);
  if (codes.includes('NOT_FOUND')) return apiErrorHint(404);
  return 'Glue refused the request. The reason above says why; check the IDs and values sent.';
}
