import { describe, expect, it } from 'vitest';
import { ConfigError, LoginError, UsageError, redact, safeErrorMessage } from '../src/errors.js';

describe('redact', () => {
  it('masks the middle and hides short values', () => {
    expect(redact('abcdefghijklmnop')).toBe('abcd****mnop');
    expect(redact('short')).toBe('****');
  });
});

describe('safeErrorMessage', () => {
  it.each([
    ['https://user:pass@example.com/x', 'pass'],
    ['failed with Bearer abc.def-ghi', 'abc.def-ghi'],
    ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig was bad', 'eyJhbGci'],
    ['POST https://example.com/v1/token?key=AIzaSECRET failed', 'AIzaSECRET'],
    ['refresh_token=abc123&grant_type=x', 'abc123'],
  ])('removes the credential from %s', (input, secret) => {
    expect(safeErrorMessage(input)).not.toContain(secret);
  });

  it('leaves ordinary text alone', () => {
    expect(safeErrorMessage('thread not found: thr_123')).toBe('thread not found: thr_123');
  });
});

describe('error classes', () => {
  it('UsageError and LoginError are ConfigErrors with a hint', () => {
    expect(new UsageError('bad', 'fix')).toBeInstanceOf(ConfigError);
    expect(new LoginError('bad', 'fix').hint).toBe('fix');
  });
});
