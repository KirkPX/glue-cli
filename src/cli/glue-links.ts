import { UsageError } from '../errors.js';

// A Glue link written with an escaped underscore (thr\_… or thr%5C_…) does not open. Markdown
// tools add the backslash. The CLI never changes a message's text, so it refuses the text and
// shows the corrected links instead.
const BAD_LINK = /https?:\/\/app\.glue\.ai\/[^\s)>\]]*?(?:\\_|%5C_)[^\s)>\]]*/gi;

export function assertGlueLinks(text: string): void {
  const bad = text.match(BAD_LINK);
  if (!bad) return;
  const fixed = [...new Set(bad)].map((link) => `  ${link}  →  ${link.replace(/\\_|%5C_/gi, '_')}`);
  throw new UsageError(
    `${bad.length === 1 ? 'A Glue link has' : `${bad.length} Glue links have`} a backslash before an underscore, so ${bad.length === 1 ? 'it does' : 'they do'} not open.`,
    `Remove the backslash and send again:\n${fixed.join('\n')}`,
  );
}
