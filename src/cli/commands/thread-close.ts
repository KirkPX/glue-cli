import { assertWritable, confirmOrAbort, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function threadCloseCommand(id: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would close thread ${id}`)) return;
  if (!(await confirmOrAbort(`Close thread ${id}?`, opts, r))) return;
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.closeThread(id);

  if (r.format === 'pretty') {
    r.line(`Closed: ${result.subject || result.id}`);
  } else {
    r.result(result);
  }
}
