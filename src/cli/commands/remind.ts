import { assertWritable, reportDryRun } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { UsageError } from '../../errors.js';

import { parseWhen } from '../parse.js';

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
    try {
      remindAt = parseWhen(when);
    } catch (error) {
      throw new UsageError((error as Error).message, 'glue remind <thr_…> 2h  |  glue remind <thr_…> 2026-05-29T09:00Z  |  glue remind <thr_…> --clear');
    }
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
