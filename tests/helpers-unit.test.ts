import { describe, expect, it } from 'vitest';
import { parseNewSubject, renameFromEvent, renameFromMessage } from '../src/cli/rename.js';
import { SIMILARITY_THRESHOLD, similarityRatio } from '../src/cli/similarity.js';

describe('similarity', () => {
  it('treats identical text as 1 and unrelated text as below the threshold', () => {
    expect(similarityRatio('same', 'same')).toBe(1);
    expect(similarityRatio('', '')).toBe(1);
    expect(similarityRatio('the budget is ready', 'lunch at noon?')).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('treats a small revision as above the threshold', () => {
    expect(similarityRatio('the budget is ready', 'the budget is ready.')).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });
});

describe('rename events', () => {
  it('reads straight and curly quotes', () => {
    expect(parseNewSubject('Ann changed the subject to "New"')).toBe('New');
    expect(parseNewSubject('Ann changed the subject to “New”')).toBe('New');
    expect(parseNewSubject('hello')).toBeNull();
    expect(parseNewSubject(null)).toBeNull();
  });

  it('builds a record from a stored system message and ignores others', () => {
    const stored = { type: 'system', text: 'Ann changed the subject to "New"', id: 'm1', cid: 'thread:thr_1', user: { id: 'u', name: 'Ann' } };
    expect(renameFromMessage(stored)).toMatchObject({ threadId: 'thr_1', newSubject: 'New', via: 'history' });
    expect(renameFromMessage({ ...stored, type: 'regular' })).toBeNull();
  });

  it('builds a record from a live event', () => {
    const event = { type: 'message.updated', channel_id: 'thr_2', message: { type: 'system', text: 'Ann changed the subject to "New"' } };
    expect(renameFromEvent(event)).toMatchObject({ threadId: 'thr_2', via: 'message.updated' });
  });
});
