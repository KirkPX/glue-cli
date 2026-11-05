import { assertWritable, reportDryRun, type GuardOptions, confirmOrAbort } from '../guardrails.js';
import { reporter } from '../output.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { resolveGroup } from '../resolve.js';

export async function groupDeleteCommand(nameOrId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would delete group ${nameOrId}`)) return;
  if (!(await confirmOrAbort(`Delete group ${nameOrId}?`, opts, r))) return;
  validateConfig();
  const client = new GlueAPIClient();
  const groupId = await resolveGroup(client, nameOrId);
  const result = await client.deleteGroup(groupId);

  if (r.format === 'pretty') {
    r.line(result ? `Deleted group: ${groupId}` : `Failed to delete group: ${groupId}`);
  } else {
    r.result({ deleted: result, id: groupId });
  }
}
