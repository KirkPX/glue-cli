import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveGroup } from '../resolve.js';

export async function groupLeaveCommand(nameOrId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would leave group ${nameOrId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const groupId = await resolveGroup(client, nameOrId);
  await client.leaveGroup(groupId);

  if (r.format === 'pretty') {
    r.line(`Left group: ${nameOrId} (${groupId})`);
  } else {
    r.result({ left: true, id: groupId });
  }
}
