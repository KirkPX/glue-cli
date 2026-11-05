import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveGroup, resolveRecipient } from '../resolve.js';

export async function groupAddCommand(groupNameOrId: string, names: string[], opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would add ${names.join(', ')} to group ${groupNameOrId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();

  const groupId = await resolveGroup(client, groupNameOrId);
  const memberIds = await Promise.all(names.map(n => resolveRecipient(client, n)));
  const result = await client.addGroupMembers(groupId, memberIds);

  if (r.format === 'pretty') {
    r.line(`Added ${names.join(', ')} to group: ${result.name} (${result.id})`);
  } else {
    r.result(result);
  }
}
