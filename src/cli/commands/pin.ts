import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function pinCommand(messageId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would pin message ${messageId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.pinMessage(messageId);

  if (r.format === 'pretty') {
    r.line(`Pinned message: ${messageId}`);
  } else {
    r.result(result);
  }
}
