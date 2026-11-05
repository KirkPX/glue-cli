import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveGroup } from '../resolve.js';

export async function groupJoinCommand(nameOrId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would join group ${nameOrId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const groupId = await resolveGroup(client, nameOrId);
  const result = await client.joinGroup(groupId);

  if (r.format === 'pretty') {
    r.line(`Joined group: ${result.name} (${result.id})`);
  } else {
    r.result(result);
  }
}
