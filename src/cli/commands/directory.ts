import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { getCache } from '../../services/cache.js';

// `glue directory` — browse the locally-accrued index of people and groups.
//
// The directory is the same store the CLI uses to resolve names to IDs, exposed
// for reading. It fills in as you use the CLI: every `glue people <search>` and
// every `--to` / `--group` resolution records what it learned. Groups can be
// pulled in full on demand (`--refresh`); people accrue incrementally because
// the Glue API only supports searching members, not listing them all.
export async function directoryCommand(opts: {
  refresh?: boolean;
  clear?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  const cache = getCache();

  if (opts.clear) {
    cache.clear();
    r.result({ cleared: true });
    return;
  }

  if (opts.refresh) {
    validateConfig();
    const client = new GlueAPIClient();
    const groups = await client.getAllGroups();
    cache.replaceGroups(groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: (g as any).description,
      memberCount: (g as any).memberCount,
    })));
  }

  const users = cache.allUsers();
  const groups = cache.allGroups();

  if (r.format === 'pretty') {
    r.line(`People (${users.length}):\n`);
    for (const u of users) {
      const parts = [`  ${u.name} (${u.id})`];
      if (u.email) parts.push(`<${u.email}>`);
      if (u.location) parts.push(`- ${u.location}`);
      if (u.timezone) parts.push(`[${u.timezone}]`);
      r.line(parts.join(' '));
    }
    if (users.length === 0) r.line('  (none yet — run `glue people <name>` to start filling this in)');

    r.line(`\nGroups (${groups.length}):\n`);
    for (const g of groups) {
      const parts = [`  ${g.name} (${g.id})`];
      if (g.memberCount) parts.push(`— ${g.memberCount} members`);
      r.line(parts.join(' '));
      if (g.description) r.line(`    ${g.description}`);
    }
    if (groups.length === 0) r.line('  (none yet — run `glue directory --refresh` to pull the full group list)');
  } else {
    r.result({ people: users, groups });
  }
}
