import { describe, expect, it } from 'vitest';
import { ConfigError, LoginError, UsageError, fileErrorReason, graphqlErrorHint, redact, safeErrorMessage } from '../src/errors.js';

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

describe('fileErrorReason', () => {
  it.each([
    ['ENOENT', 'the file or its folder does not exist'],
    ['EISDIR', 'it is a folder, not a file'],
    ['ENOTDIR', 'part of the path is a file, not a folder'],
    // Windows says EEXIST when a file is in the way of a folder.
    ['EEXIST', 'part of the path is a file, not a folder'],
    ['EACCES', 'you do not have permission'],
    ['EPERM', 'you do not have permission'],
    ['EROFS', 'the disk is read-only'],
    ['ENOSPC', 'the disk is full'],
  ])('%s reads as plain words', (code, words) => {
    expect(fileErrorReason(Object.assign(new Error('raw'), { code }))).toBe(words);
  });
});

describe('graphqlErrorHint', () => {
  const combined = (code?: string) => ({ name: 'CombinedGraphQLErrors', errors: [{ message: 'm', extensions: { code } }] });
  it('gives each refusal code its next step', () => {
    expect(graphqlErrorHint(combined('UNAUTHENTICATED'))).toMatch(/glue login --force/);
    expect(graphqlErrorHint(combined('FORBIDDEN'))).toMatch(/may not be allowed/);
    expect(graphqlErrorHint(combined('NOT_FOUND'))).toMatch(/Check the ID/);
    expect(graphqlErrorHint(combined())).toMatch(/reason above/);
    expect(graphqlErrorHint(new Error('other'))).toBeUndefined();
  });
});
