import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveRecipientOrGroup } from '../resolve.js';

export async function threadAddCommand(threadId: string, names: string[], opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would add ${names.join(', ')} to thread ${threadId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();

  const ids = await Promise.all(names.map(n => resolveRecipientOrGroup(client, n)));
  const result = await client.addThreadRecipients(threadId, ids);

  const recipients = result.recipients.edges.map((e: any) => e.node);
  if (r.format === 'pretty') {
    r.line(`Added to thread: ${result.subject || result.id}`);
    r.line(`Recipients (${result.recipients.totalCount}):`);
    for (const item of recipients) {
      const label = item.id.startsWith('grp_') ? `[${item.name}]` : item.name;
      r.line(`  ${label} (${item.id})`);
    }
  } else {
    r.result(result);
  }
}
