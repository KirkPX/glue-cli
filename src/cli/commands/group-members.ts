import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveGroup } from '../resolve.js';

export async function groupMembersCommand(groupNameOrId: string, opts: { pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();

  const groupId = await resolveGroup(client, groupNameOrId);
  const result = await client.getAllGroupMembers(groupId);

  if (r.format === 'pretty') {
    r.line(`${result.group.name} — ${result.totalCount} members:\n`);
    for (const m of result.members) {
      const role = m.role === 'admin' ? ' (admin)' : '';
      r.line(`  ${m.name}${role}  ${m.id}`);
    }
  } else {
    r.result(result);
  }
}
