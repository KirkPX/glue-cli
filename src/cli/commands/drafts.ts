import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function draftsCommand(opts: { last?: string; pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const last = parseInt(opts.last || '50', 10);
  const drafts = await client.getDrafts(last);
  const nodes = (drafts.edges || []).map((e: any) => e.node);

  if (r.format === 'pretty') {
    r.line(`Drafts: ${drafts.totalCount}`);
    r.line('---');
    for (const d of nodes) {
      const to = (d.recipients || []).map((r: any) => r.name).join(', ') || '(no recipients)';
      r.line(`\n${d.subject || '(No subject)'} (${d.id})`);
      r.line(`  To: ${to}`);
      r.line(`  ${d.message?.textPreview || ''}`);
    }
  } else {
    r.result(nodes);
  }
}
