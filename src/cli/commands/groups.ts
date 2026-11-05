import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { getCache } from '../../services/cache.js';

export async function groupsCommand(opts: { pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const groups = await client.getAllGroups();

  // Warm the directory: listing all groups is the authoritative source, so
  // record every one (name→ID + context) for later resolution and `glue directory`.
  const cache = getCache();
  for (const g of groups) {
    cache.setGroup(g.name, g.id, {
      description: (g as any).description,
      memberCount: (g as any).memberCount,
    });
  }

  if (r.format === 'pretty') {
    r.line(`Groups (${groups.length}):\n`);
    for (const g of groups) {
      const parts = [`  ${g.name} (${g.id})`];
      if ((g as any).memberCount) parts.push(`— ${(g as any).memberCount} members`);
      r.line(parts.join(' '));
      if ((g as any).description) r.line(`    ${(g as any).description}`);
    }
  } else {
    r.result(groups);
  }
}
