import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function threadReopenCommand(id: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would reopen thread ${id}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.reopenThread(id);

  if (r.format === 'pretty') {
    r.line(`Reopened: ${result.subject || result.id}`);
  } else {
    r.result(result);
  }
}
