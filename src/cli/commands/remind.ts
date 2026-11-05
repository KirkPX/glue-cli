import { assertWritable, reportDryRun } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { UsageError } from '../../errors.js';

// glue remind <threadId> <when> | glue remind <threadId> --clear
// <when> is an ISO timestamp (e.g. 2026-05-29T09:00:00Z) or a relative form like "2h", "30m", "1d".
function parseWhen(when: string): string {
  const rel = when.match(/^(\d+)\s*(m|min|h|hr|hour|d|day)s?$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unitMs = /^m/i.test(rel[2]) ? 60_000 : /^h/i.test(rel[2]) ? 3_600_000 : 86_400_000;
    return new Date(Date.now() + n * unitMs).toISOString();
  }
  const d = new Date(when);
  if (isNaN(d.getTime())) {
    throw new UsageError(`could not parse reminder time: "${when}"`, 'Use an ISO timestamp (2026-05-29T09:00:00Z) or a relative form: 30m, 2h, 1d.');
  }
  return d.toISOString();
}

export async function remindCommand(threadId: string, when: string | undefined, opts: { dryRun?: boolean; readOnly?: boolean; json?: boolean; clear?: boolean; pretty?: boolean }) {
  const r = reporter(opts);
  assertWritable(opts);
  validateConfig();
  const client = new GlueAPIClient();

  let remindAt: string | null;
  if (opts.clear) {
    remindAt = null;
  } else if (!when) {
    throw new UsageError('specify when to be reminded, or pass --clear', 'glue remind <thr_…> 2h  |  glue remind <thr_…> 2026-05-29T09:00:00Z  |  glue remind <thr_…> --clear');
  } else {
    remindAt = parseWhen(when);
  }

  if (reportDryRun(opts, r, remindAt ? `Would set a reminder on ${threadId} for ${remindAt}` : `Would clear the reminder on ${threadId}`)) return;

  const edges = await client.setThreadReminder(threadId, remindAt);
  if (r.format === 'pretty') {
    const e = edges[0];
    r.line(remindAt ? `Reminder set for ${threadId} at ${e?.remindAt}` : `Reminder cleared for ${threadId}`);
  } else {
    r.result(edges);
  }
}
