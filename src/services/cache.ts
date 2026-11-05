import { configDir } from '../paths.js';
import fs from 'fs';
import path from 'path';

// Name→ID directory for people and groups. Doubles as the resolution cache
// (fast-path for `--to` / `--group` name lookups) and as the browsable index
// behind `glue directory`. Entries are DURABLE — Glue IDs are immutable, so a
// confirmed name→ID mapping is kept indefinitely and accrues as the CLI is used.
// The only drift risk is a *name* later reused for a different entity (rare);
// `--no-cache`, `glue directory --refresh`, and `glue directory --clear` are the
// escape hatches.

const cacheFile = () => path.join(configDir(), 'cache.json');

export interface UserEntry {
  id: string;
  name: string;
  cachedAt: number;
  email?: string;
  location?: string;
  timezone?: string;
}

export interface GroupEntry {
  id: string;
  name: string;
  cachedAt: number;
  description?: string;
  memberCount?: number;
}

export interface UserContext {
  email?: string;
  location?: string;
  timezone?: string;
}

export interface GroupContext {
  description?: string;
  memberCount?: number;
}

interface CacheFile {
  version: 2;
  users: Record<string, UserEntry>;
  groups: Record<string, GroupEntry>;
}

function emptyCacheFile(): CacheFile {
  return { version: 2, users: {}, groups: {} };
}

// Drop undefined keys so we never overwrite existing context with blanks.
function pruneUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) (out as any)[k] = v;
  }
  return out;
}

export class CacheService {
  private data: CacheFile;

  constructor() {
    this.data = this.read();
  }

  private read(): CacheFile {
    try {
      if (fs.existsSync(cacheFile())) {
        const parsed = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
        // v1 (thin entries, TTL-based) and v2 share a compatible shape — v1's
        // {id,name,cachedAt} entries are valid UserEntry/GroupEntry, so we adopt
        // them as-is and just re-stamp the version on next write.
        if (parsed && (parsed.version === 1 || parsed.version === 2)) {
          return { version: 2, users: parsed.users || {}, groups: parsed.groups || {} };
        }
      }
    } catch {
      // Corrupted file — treat as empty
    }
    return emptyCacheFile();
  }

  private write(): void {
    try {
      const dir = path.dirname(cacheFile());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cacheFile(), JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // Write failure is silent — the directory is advisory
    }
  }

  getUser(name: string): string | null {
    return this.data.users[name.toLowerCase()]?.id ?? null;
  }

  setUser(name: string, id: string, context?: UserContext): void {
    const existing = this.data.users[name.toLowerCase()];
    this.data.users[name.toLowerCase()] = {
      ...existing,
      ...(context ? pruneUndefined(context) : {}),
      id,
      name,
      cachedAt: Date.now(),
    };
    this.write();
  }

  evictUser(name: string): void {
    delete this.data.users[name.toLowerCase()];
    this.write();
  }

  getGroup(name: string): string | null {
    return this.data.groups[name.toLowerCase()]?.id ?? null;
  }

  setGroup(name: string, id: string, context?: GroupContext): void {
    const existing = this.data.groups[name.toLowerCase()];
    this.data.groups[name.toLowerCase()] = {
      ...existing,
      ...(context ? pruneUndefined(context) : {}),
      id,
      name,
      cachedAt: Date.now(),
    };
    this.write();
  }

  evictGroup(name: string): void {
    delete this.data.groups[name.toLowerCase()];
    this.write();
  }

  allUsers(): UserEntry[] {
    return Object.values(this.data.users).sort((a, b) => a.name.localeCompare(b.name));
  }

  allGroups(): GroupEntry[] {
    return Object.values(this.data.groups).sort((a, b) => a.name.localeCompare(b.name));
  }

  // Replace the entire group set (used by `glue directory --refresh`, where
  // getAllGroups is the source of truth and stale group entries should drop).
  replaceGroups(groups: Array<{ id: string; name: string; description?: string; memberCount?: number }>): void {
    this.data.groups = {};
    for (const g of groups) {
      this.data.groups[g.name.toLowerCase()] = {
        ...pruneUndefined({ description: g.description, memberCount: g.memberCount }),
        id: g.id,
        name: g.name,
        cachedAt: Date.now(),
      };
    }
    this.write();
  }

  clear(): void {
    this.data = emptyCacheFile();
    this.write();
  }
}

export interface Cache {
  getUser(name: string): string | null;
  setUser(name: string, id: string, context?: UserContext): void;
  evictUser(name: string): void;
  getGroup(name: string): string | null;
  setGroup(name: string, id: string, context?: GroupContext): void;
  evictGroup(name: string): void;
  allUsers(): UserEntry[];
  allGroups(): GroupEntry[];
  replaceGroups(groups: Array<{ id: string; name: string; description?: string; memberCount?: number }>): void;
  clear(): void;
}

let instance: Cache | null = null;
let disabled = false;

const noopCache: Cache = {
  getUser: () => null,
  setUser: () => {},
  evictUser: () => {},
  getGroup: () => null,
  setGroup: () => {},
  evictGroup: () => {},
  allUsers: () => [],
  allGroups: () => [],
  replaceGroups: () => {},
  clear: () => {},
};

export function getCache(): Cache {
  if (disabled) return noopCache;
  if (!instance) instance = new CacheService();
  return instance;
}

export function setCacheDisabled(value: boolean): void {
  disabled = value;
}
