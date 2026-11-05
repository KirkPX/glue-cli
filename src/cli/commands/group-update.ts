import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveGroup } from '../resolve.js';

export async function groupUpdateCommand(nameOrId: string, opts: GuardOptions & { name?: string; public?: boolean; private?: boolean;  }) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would update group ${nameOrId}`)) return;
  validateConfig();

  if (opts.public && opts.private) {
    throw new UsageError('cannot set both --public and --private');
  }

  const input: { name?: string; isPublic?: boolean } = {};
  if (opts.name) input.name = opts.name;
  if (opts.public) input.isPublic = true;
  if (opts.private) input.isPublic = false;

  if (Object.keys(input).length === 0) {
    throw new UsageError('provide --name, --public, or --private to update');
  }

  const client = new GlueAPIClient();
  const groupId = await resolveGroup(client, nameOrId);
  const result = await client.updateGroup(groupId, input);

  if (r.format === 'pretty') {
    const parts = [`Updated group: ${result.name} (${result.id})`];
    if (opts.public) parts.push('→ public');
    if (opts.private) parts.push('→ private');
    r.line(parts.join(' '));
  } else {
    r.result(result);
  }
}
