import { assertWritable, reportDryRun, type GuardOptions, confirmOrAbort } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function deleteThreadCommand(id: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would delete thread ${id} and all of its messages`)) return;
  if (!(await confirmOrAbort(`Delete thread ${id} and all of its messages?`, opts, r))) return;
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.deleteThread(id);

  if (r.format === 'pretty') {
    r.line(`Deleted thread: ${id}`);
  } else {
    r.result({ deleted: true, id });
  }
}
