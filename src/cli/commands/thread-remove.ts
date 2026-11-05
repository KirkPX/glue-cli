import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveRecipientOrGroup } from '../resolve.js';

export async function threadRemoveCommand(threadId: string, names: string[], opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would remove ${names.join(', ')} from thread ${threadId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();

  // Check if this is a group chat — recipients can't be modified
  const thread = await client.getThread(threadId, 1);
  if (thread.threadType === 'groupChat') {
    const msg = `Skipped: "${thread.subject || threadId}" is a group chat — recipients can't be modified`;
    if (r.format === 'pretty') {
      r.line(msg);
    } else {
      r.result({ skipped: true, reason: 'groupChat', threadId, subject: thread.subject });
    }
    return;
  }

  const ids = await Promise.all(names.map(n => resolveRecipientOrGroup(client, n)));
  const result = await client.removeThreadRecipients(threadId, ids);

  const recipients = result.recipients.edges.map((e: any) => e.node);
  if (r.format === 'pretty') {
    r.line(`Removed from thread: ${result.subject || result.id}`);
    r.line(`Remaining recipients (${result.recipients.totalCount}):`);
    for (const item of recipients) {
      const label = item.id.startsWith('grp_') ? `[${item.name}]` : item.name;
      r.line(`  ${label} (${item.id})`);
    }
  } else {
    r.result(result);
  }
}
