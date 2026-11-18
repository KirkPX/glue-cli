import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveGroup } from '../resolve.js';
import { JOINABLE_BY, type JoinableBy } from '../../visibility.js';

const JOINABLE_LABEL: Record<JoinableBy, string> = {
  workspace: 'Open: anyone in the workspace can join',
  approval: 'Ask to join: an admin approves each request',
  domain: 'anyone with the workspace email domain can join',
  none: 'nobody can join without an invite',
};

// Who can join the group (Glue's joinableBy). --public is short for --joinable workspace,
// and --private for --joinable approval, the two choices the web app's group settings offer.
export async function groupUpdateCommand(nameOrId: string, opts: GuardOptions & { name?: string; joinable?: string; public?: boolean; private?: boolean }) {
  const r = reporter(opts);
  assertWritable(opts);

  const chosen = [opts.joinable, opts.public && 'workspace', opts.private && 'approval'].filter(Boolean) as string[];
  if (chosen.length > 1) {
    throw new UsageError('choose one of --joinable, --public or --private');
  }
  const joinableBy = chosen[0] as JoinableBy | undefined;
  if (joinableBy && !JOINABLE_BY.includes(joinableBy)) {
    throw new UsageError(`--joinable takes ${JOINABLE_BY.join(', ')}, not "${joinableBy}".`, 'workspace = Open (anyone in the workspace can join). approval = Ask to join.');
  }
  if (!opts.name && !joinableBy) {
    throw new UsageError('provide --name, --joinable, --public, or --private to update');
  }

  const changes: string[] = [];
  if (opts.name) changes.push(`rename it to "${opts.name}"`);
  if (joinableBy) changes.push(`set who can join to ${joinableBy} (${JOINABLE_LABEL[joinableBy]})`);
  if (reportDryRun(opts, r, `Would update group ${nameOrId}: ${changes.join('; ')}`)) return;
  validateConfig();

  const input: { name?: string; joinableBy?: JoinableBy } = {};
  if (opts.name) input.name = opts.name;
  if (joinableBy) input.joinableBy = joinableBy;

  const client = new GlueAPIClient();
  const groupId = await resolveGroup(client, nameOrId);
  const result = await client.updateGroup(groupId, input);
  if (joinableBy && result.joinableBy !== joinableBy) {
    // Glue answers without an error when it ignores the field, so check what it saved.
    throw new UsageError(
      `Glue kept who can join ${result.name} at ${result.joinableBy}, not ${joinableBy}.`,
      'Only a group admin can change this. Check your role with: glue group-members ' + groupId,
    );
  }

  if (r.format === 'pretty') {
    r.line(`Updated group: ${result.name} (${result.id})`);
    if (result.joinableBy) {
      const label = JOINABLE_LABEL[result.joinableBy as JoinableBy] ?? result.joinableBy;
      r.line(`Who can join: ${result.joinableBy} (${label})`);
    }
  } else {
    r.result(result);
  }
}
