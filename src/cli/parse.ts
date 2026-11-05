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
