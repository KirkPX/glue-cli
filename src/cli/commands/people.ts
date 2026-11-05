import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { getCache } from '../../services/cache.js';

export async function peopleCommand(opts: {
  search: string;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.searchMembers(opts.search);

  // Warm the directory: people can't be bulk-listed (the API is search-only),
  // so the index accrues from every search — record each hit with its context.
  const cache = getCache();
  for (const edge of result.edges) {
    const u = edge.node;
    cache.setUser(u.name, u.id, {
      email: u.profile?.emailAddress,
      location: u.profile?.location,
      timezone: u.profile?.timezone,
    });
  }

  if (r.format === 'pretty') {
    r.line(`People matching "${opts.search}": ${result.totalCount}\n`);
    for (const edge of result.edges) {
      const u = edge.node;
      const parts = [u.name, `(${u.id})`];
      if (u.profile?.emailAddress) parts.push(`<${u.profile.emailAddress}>`);
      if (u.profile?.location) parts.push(`- ${u.profile.location}`);
      if (u.profile?.timezone) parts.push(`[${u.profile.timezone}]`);
      r.line(`  ${parts.join(' ')}`);
      if (u.bio) r.line(`    ${u.bio}`);
    }
  } else {
    r.result({
      people: result.edges.map((e: any) => e.node),
      totalCount: result.totalCount,
    });
  }
}
