import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function unpinCommand(messageId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would unpin message ${messageId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  await client.unpinMessage(messageId);

  if (r.format === 'pretty') {
    r.line(`Unpinned message: ${messageId}`);
  } else {
    r.result({ unpinned: true, id: messageId });
  }
}
