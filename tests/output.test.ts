import { afterEach, describe, expect, it } from 'vitest';
import { reporterFor, resolveFormat } from '../src/cli/output.js';

const original = process.stdout.isTTY;
afterEach(() => {
  process.stdout.isTTY = original;
});

function capture(run: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...a: unknown[]) => void out.push(a.join(' '));
  console.error = (...a: unknown[]) => void err.push(a.join(' '));
  try {
    run();
  } finally {
    console.log = log;
    console.error = error;
  }
  return { out, err };
}

describe('resolveFormat', () => {
  it('gives a terminal readable text', () => {
    process.stdout.isTTY = true;
    expect(resolveFormat()).toBe('pretty');
  });

  it('gives a pipe JSON with no flag', () => {
    process.stdout.isTTY = false as unknown as true;
    expect(resolveFormat()).toBe('json');
  });

  it('--json wins at a terminal, and over --pretty', () => {
    process.stdout.isTTY = true;
    expect(resolveFormat({ json: true })).toBe('json');
    expect(resolveFormat({ json: true, pretty: true })).toBe('json');
  });

  it('--pretty still works in a pipe', () => {
    process.stdout.isTTY = false as unknown as true;
    expect(resolveFormat({ pretty: true })).toBe('pretty');
  });
});

describe('reporter', () => {
  it('json: result is parseable, line and note write nothing to stdout', () => {
    const { out } = capture(() => {
      const r = reporterFor('json');
      r.note('working');
      r.line('a line');
      r.result({ a: 1 }, 'readable');
    });
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ a: 1 });
  });

  it('pretty: result prints the readable form, and progress goes to stderr', () => {
    const { out, err } = capture(() => {
      const r = reporterFor('pretty');
      r.note('working');
      r.result({ a: 1 }, 'readable');
    });
    expect(out).toEqual(['readable']);
    expect(err).toEqual(['working']);
  });

  it('warn reaches stderr in both formats', () => {
    for (const format of ['json', 'pretty'] as const) {
      expect(capture(() => reporterFor(format).warn('careful')).err).toEqual(['careful']);
    }
  });

  it('event prints one JSON object per line', () => {
    const { out } = capture(() => reporterFor('json').event({ a: 1 }));
    expect(out).toEqual(['{"a":1}']);
  });
});
