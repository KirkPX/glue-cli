import { UsageError } from '../errors.js';
import { GlueAPIClient } from '../client-graphql.js';
import { getCache } from '../services/cache.js';

/** Takes an ID, or a pasted Glue link that holds one. */
export function idFrom(value: string, prefix: 'thr' | 'msg'): string {
  if (!value.includes('://')) return value;
  const match = value.match(new RegExp(`\\b${prefix}_[A-Za-z0-9]+`));
  if (!match) throw new UsageError(`No ${prefix}_ ID in that link: ${value}`);
  return match[0];
}

// Resolve a name to a user/group ID. Exits on no match or ambiguous match.
export async function resolveRecipient(client: GlueAPIClient, name: string): Promise<string> {
  // If it already looks like an ID, pass through
  if (name.startsWith('usr_') || name.startsWith('grp_')) {
    return name;
  }

  const cache = getCache();
  const cached = cache.getUser(name);
  if (cached) return cached;

  const result = await client.searchMembers(name);
  if (result.edges.length === 0) {
    throw new UsageError(`no user found matching "${name}"`);
  }
  if (result.edges.length > 1) {
    const matches = result.edges.map((e: any) => e.node.name).join(', ');
    throw new UsageError(`"${name}" matches multiple users: ${matches}. Be more specific.`);
  }
  const node = result.edges[0].node;
  cache.setUser(name, node.id, {
    email: node.profile?.emailAddress,
    location: node.profile?.location,
    timezone: node.profile?.timezone,
  });
  return node.id;
}

// Resolve a name to a user or group ID. Tries users first, then groups.
export async function resolveRecipientOrGroup(client: GlueAPIClient, name: string): Promise<string> {
  if (name.startsWith('usr_') || name.startsWith('grp_')) {
    return name;
  }

  const cache = getCache();
  const cachedUser = cache.getUser(name);
  if (cachedUser) return cachedUser;
  const cachedGroup = cache.getGroup(name);
  if (cachedGroup) return cachedGroup;

  const [users, groups] = await Promise.all([
    client.searchMembers(name),
    client.searchGroups(name),
  ]);

  const userMatches = users.edges.filter((e: any) =>
    e.node.name.toLowerCase().includes(name.toLowerCase())
  );
  const groupMatches = groups.edges.filter((e: any) =>
    e.node.name.toLowerCase().includes(name.toLowerCase())
  );

  const total = userMatches.length + groupMatches.length;
  if (total === 0) {
    throw new UsageError(`no user or group found matching "${name}"`);
  }
  if (total > 1) {
    const all = [
      ...userMatches.map((e: any) => `${e.node.name} (user)`),
      ...groupMatches.map((e: any) => `${e.node.name} (group)`),
    ].join(', ');
    throw new UsageError(`"${name}" matches multiple: ${all}. Be more specific.`);
  }

  const id = userMatches.length === 1 ? userMatches[0].node.id : groupMatches[0].node.id;
  if (id.startsWith('usr_')) {
    cache.setUser(name, id);
  } else {
    cache.setGroup(name, id);
  }
  return id;
}

// Resolve a group name to a group ID
export async function resolveGroup(client: GlueAPIClient, nameOrId: string): Promise<string> {
  if (nameOrId.startsWith('grp_')) {
    return nameOrId;
  }

  const cache = getCache();
  const cached = cache.getGroup(nameOrId);
  if (cached) return cached;

  const result = await client.searchGroups(nameOrId);
  if (result.edges.length === 0) {
    throw new UsageError(`no group found matching "${nameOrId}"`);
  }
  if (result.edges.length > 1) {
    const matches = result.edges.map((e: any) => e.node.name).join(', ');
    throw new UsageError(`"${nameOrId}" matches multiple groups: ${matches}. Be more specific.`);
  }
  const id = result.edges[0].node.id;
  cache.setGroup(nameOrId, id);
  return id;
}
