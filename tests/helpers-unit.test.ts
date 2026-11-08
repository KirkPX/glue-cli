import { describe, expect, it } from 'vitest';
import { parseDate, parseWhen } from '../src/cli/parse.js';
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

describe('dates and reminder times', () => {
  const now = Date.UTC(2026, 4, 1, 12, 0, 0);
  it('accepts real dates in both forms', () => {
    expect(parseDate('2026-02-28')).toBe('2026-02-28');
    expect(parseDate('20260228')).toBe('2026-02-28');
  });
  it.each(['2026-02-30', '2026-13-01', '1', 'soon', '2026-2-3'])('refuses the date %s', (value) => {
    expect(() => parseDate(value)).toThrow(/YYYY-MM-DD/);
  });
  it('reads relative and absolute reminder times', () => {
    expect(parseWhen('2h', now)).toBe('2026-05-01T14:00:00.000Z');
    expect(parseWhen('30m', now)).toBe('2026-05-01T12:30:00.000Z');
    expect(parseWhen('2026-05-29', now)).toBe('2026-05-29T00:00:00.000Z');
    expect(parseWhen('2026-05-29T09:00Z', now)).toBe('2026-05-29T09:00:00.000Z');
    expect(parseWhen('2026-05-29T09:00:30+02:00', now)).toBe('2026-05-29T07:00:30.000Z');
  });
  it.each(['1', '0m', '2026-02-30T09:00Z', '2026-05-29T25:00Z', 'tomorrow', '2026-04-01T09:00Z'])(
    'refuses the reminder time %s',
    (value) => {
      expect(() => parseWhen(value, now)).toThrow();
    },
  );
});
