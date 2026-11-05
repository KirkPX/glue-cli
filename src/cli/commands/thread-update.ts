import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function threadUpdateCommand(id: string, opts: GuardOptions & { subject?: string; public?: boolean; private?: boolean;  }) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would update thread ${id}`)) return;
  validateConfig();

  if (opts.public && opts.private) {
    throw new UsageError('cannot set both --public and --private');
  }

  const input: { subject?: string; isPublic?: boolean } = {};
  if (opts.subject) input.subject = opts.subject;
  if (opts.public) input.isPublic = true;
  if (opts.private) input.isPublic = false;

  if (Object.keys(input).length === 0) {
    throw new UsageError('provide --subject, --public, or --private to update');
  }

  const client = new GlueAPIClient();
  const result = await client.updateThread(id, input);

  if (r.format === 'pretty') {
    const parts = [`Updated thread: ${result.subject} (${result.id})`];
    if (opts.public) parts.push('→ public');
    if (opts.private) parts.push('→ private');
    r.line(parts.join(' '));
    const recipients = result.recipients?.edges?.map((e: any) => e.node) || [];
    if (recipients.length > 0) {
      r.line(`Recipients (${result.recipients.totalCount}):`);
      for (const item of recipients) {
        const label = item.id.startsWith('grp_') ? `[${item.name}]` : item.name;
        r.line(`  ${label} (${item.id})`);
      }
    }
  } else {
    r.result(result);
  }
}
