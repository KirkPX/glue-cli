import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { callWithPolicy, request, retryAfterMs, safeDetail, type RetryInfo } from '../src/client.js';
import { ApiError, NetworkError, TimeoutError } from '../src/errors.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

/** Answers each request with the next status in the list. The last one repeats. */
function serve(statuses: number[], headers: Record<string, string> = {}): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  server = createServer((_, res) => {
    const status = statuses[Math.min(hits, statuses.length - 1)];
    hits++;
    res.writeHead(status, headers);
    res.end('{}');
  });
  return new Promise((resolve) =>
    server!.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`, hits: () => hits }),
    ),
  );
}

const quick = { baseDelayMs: 1, onRetry: () => undefined };

describe('request', () => {
  it('retries a read on 5xx, and reports each retry', async () => {
    const { url, hits } = await serve([503, 200]);
    const seen: RetryInfo[] = [];
    const response = await request(url, {}, { operation: 'read', retry: 'safe', baseDelayMs: 1, onRetry: (i) => seen.push(i) });
    expect(response.status).toBe(200);
    expect(hits()).toBe(2);
    expect(seen[0]).toMatchObject({ attempt: 1, maxAttempts: 3, operation: 'read' });
  });

  it('stops after the limit and returns the last answer', async () => {
    const { url, hits } = await serve([500]);
    const response = await request(url, {}, { operation: 'read', retry: 'safe', ...quick });
    expect(response.status).toBe(500);
    expect(hits()).toBe(3);
  });

  it('never retries a change on 5xx, because it may have happened', async () => {
    const { url, hits } = await serve([500, 200]);
    const response = await request(url, {}, { operation: 'write', retry: 'rate-limit', ...quick });
    expect(response.status).toBe(500);
    expect(hits()).toBe(1);
  });

  it('retries a change on 429, because the server refused it', async () => {
    const { url, hits } = await serve([429, 200], { 'retry-after': '0' });
    const response = await request(url, {}, { operation: 'write', retry: 'rate-limit', ...quick });
    expect(response.status).toBe(200);
    expect(hits()).toBe(2);
  });

  it('does not wait out a very long Retry-After', async () => {
    const { url, hits } = await serve([429], { 'retry-after': '3600' });
    const response = await request(url, {}, { operation: 'read', retry: 'safe', ...quick });
    expect(response.status).toBe(429);
    expect(hits()).toBe(1);
  });

  it('raises TimeoutError when the server stalls, and does not retry', async () => {
    let hits = 0;
    server = createServer(() => {
      hits++; // never answers
    });
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    await expect(request(url, {}, { operation: 'read', retry: 'safe', timeoutMs: 50, ...quick })).rejects.toBeInstanceOf(TimeoutError);
    expect(hits).toBe(1);
    server.closeAllConnections();
  });

  it('turns a refused connection into a plain message that names the host', async () => {
    // A port that was just open is now closed, so the connection is refused.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', () => resolve()));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const error = await request(`http://127.0.0.1:${port}/`, {}, { operation: 'Read', retry: 'safe', ...quick }).catch((e) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toBe(`Read could not reach 127.0.0.1:${port}: the connection was refused.`);
    expect(error.hint).toContain('connection');
  });

  it('never prints credentials from the URL', async () => {
    const error = await request('http://user:secret@127.0.0.1:9/', {}, { operation: 'Read' }).catch((e) => e);
    expect(String(error.message)).not.toContain('secret');
  });
});

describe('callWithPolicy, for the chat library', () => {
  it('retries a read, then succeeds', async () => {
    let calls = 0;
    const result = await callWithPolicy(
      async () => {
        if (++calls === 1) throw Object.assign(new Error('busy'), { status: 503 });
        return 'ok';
      },
      { operation: 'Stream read', retry: 'safe', statusOf: (e: any) => e.status, ...quick },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry a change on 5xx, and raises ApiError', async () => {
    let calls = 0;
    const error = await callWithPolicy(
      async () => {
        calls++;
        throw Object.assign(new Error('Bearer abc.def failed'), { status: 500 });
      },
      { operation: 'Stream send', retry: 'rate-limit', statusOf: (e: any) => e.status, ...quick },
    ).catch((e) => e);
    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).not.toContain('abc.def');
  });

  it('raises TimeoutError on a call that never finishes', async () => {
    await expect(
      callWithPolicy(() => new Promise(() => undefined), { operation: 'Stream connect', timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('helpers', () => {
  it('reads Retry-After in seconds and as a date', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
    expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(0);
  });

  it('takes the message from a JSON body and never the raw body', () => {
    expect(safeDetail('{"errors":[{"message":"nope"}]}')).toBe('nope');
    expect(safeDetail('<html>secret</html>')).toBe('no response detail');
    expect(safeDetail('{"error":{"message":"TOKEN_EXPIRED"}}')).toBe('TOKEN_EXPIRED');
  });
});
