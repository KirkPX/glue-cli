import { InvalidArgumentError } from 'commander';

// Parsers for number options. parseInt turns `abc` into NaN and `12abc` into 12, which then reaches
// the server or reads as no limit. These refuse it before the command runs, and commander names the
// option in the message. They return the text, because the handlers read these options as text.

function whole(value: string): string {
  const text = value.trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) {
    throw new InvalidArgumentError(`Expected a whole number, not "${value}".`);
  }
  return text;
}

/** A count that must be at least 1, such as --limit. */
export function positive(value: string): string {
  const text = whole(value);
  if (Number(text) === 0) throw new InvalidArgumentError('Expected a number greater than 0.');
  return text;
}

/** A count that can be 0, such as a wait in milliseconds. */
export function count(value: string): string {
  return whole(value);
}

/**
 * A calendar date, typed as YYYY-MM-DD or YYYYMMDD. Returns YYYY-MM-DD. JavaScript turns an
 * impossible date such as 2026-02-30 into March 2, so it is refused here.
 */
export function parseDate(value: string): string {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value.trim());
  const [, y, m, d] = match ?? [];
  const date = match ? new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))) : null;
  if (!date || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    throw new InvalidArgumentError(`Expected a date as YYYY-MM-DD or YYYYMMDD, not "${value}".`);
  }
  return `${y}-${m}-${d}`;
}

/**
 * A moment for a reminder: a relative form (30m, 2h, 1d), a date (YYYY-MM-DD, midnight UTC), or a
 * date and time (2026-05-29T09:00, with Z or an offset; local time without one). Returns ISO 8601.
 * `new Date()` reads "1" as the year 2001, so only these forms are accepted.
 */
export function parseWhen(value: string, now = Date.now()): string {
  const text = value.trim();
  const rel = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    if (n === 0) throw new InvalidArgumentError('Expected a time after now, not 0.');
    const unitMs = /^m/i.test(rel[2]!) ? 60_000 : /^h/i.test(rel[2]!) ? 3_600_000 : 86_400_000;
    return new Date(now + n * unitMs).toISOString();
  }
  const full = /^(\d{4}-?\d{2}-?\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text);
  if (!full) {
    throw new InvalidArgumentError(
      `Expected 30m, 2h, 1d, a date (2026-05-29) or a date and time (2026-05-29T09:00Z), not "${value}".`,
    );
  }
  const date = parseDate(full[1]!);
  const [, , hh, mm, ss, zone] = full;
  if (hh !== undefined && (Number(hh) > 23 || Number(mm) > 59 || Number(ss ?? 0) > 59)) {
    throw new InvalidArgumentError(`"${value}" is not a real time of day.`);
  }
  const iso = hh === undefined ? `${date}T00:00:00Z` : `${date}T${hh}:${mm}:${ss ?? '00'}${zone ?? ''}`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new InvalidArgumentError(`"${value}" is not a real time.`);
  if (at.getTime() < now - 60_000) throw new InvalidArgumentError(`"${value}" is in the past.`);
  return at.toISOString();
}
