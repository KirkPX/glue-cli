/**
 * Body-similarity check for the send-dedupe gate.
 * Used to decide whether a follow-up send inside the 5-min window is a
 * revision (auto-update) or a wholly different message (refuse and ask).
 */

export const SIMILARITY_THRESHOLD = 0.7;

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row dynamic programming, O(min(a,b)) memory.
  // Always iterate over the longer string on the outside.
  const [s, t] = a.length >= b.length ? [a, b] : [b, a];
  const m = s.length;
  const n = t.length;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/** Returns a 0..1 similarity ratio. 1.0 = identical, 0.0 = entirely different. */
export function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}
