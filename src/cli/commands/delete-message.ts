import { assertWritable, reportDryRun, type GuardOptions, confirmOrAbort } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function deleteMessageCommand(id: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would delete message ${id}`)) return;
  if (!(await confirmOrAbort(`Delete message ${id}?`, opts, r))) return;
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.deleteMessage(id);

  if (r.format === 'pretty') {
    r.line(result ? `Deleted message: ${id}` : `Delete failed: ${id}`);
  } else {
    r.result({ deleted: result, id });
  }
}
