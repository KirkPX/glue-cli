import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig, config } from '../../config.js';
import { reporter } from '../output.js';
import { StreamService } from '../../client-realtime.js';
import { renameFromMessage, type RenameRecord } from '../rename.js';

// Sweep recent threads for subject-change ("rename") history, for auditing how a
// thread-naming convention is being adopted. Rename events aren't queryable in
// GraphQL (they're GetStream `type:"system"` messages), so there's no server-side
// "find renamed threads" — this fans out: enumerate threads (GraphQL), then read
// each thread's GetStream channel and collect its subject-change events.
//
// Scope note: only threads the authenticated user is a recipient of are visible,
// and GetStream retention may drop very old rename events. This is a sweep of the
// caller's recent threads, not a workspace-wide server query.

// Read-only throughout: lists threads and reads channel messages. No mutations.

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function renameAuditCommand(opts: {
  threads?: string;
  limit?: string;
  concurrency?: string;
  rate?: string;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  validateConfig();
  const threadsToScan = parseInt(opts.threads || '50', 10);
  const msgLimit = parseInt(opts.limit || '200', 10);
  const concurrency = parseInt(opts.concurrency || '8', 10);
  // GetStream rate-limits single-channel queries (GetOrCreateChannel) at ~60/min;
  // exceeding it returns "error code 9: Too many requests" and every further query
  // in that window fails. Concurrency can't beat a throughput cap, so we evenly
  // space query *starts* to stay under `rate` calls/min. Full ~500-thread sweep at
  // 50/min ≈ 10 min. A spaced gate beats bursting because it never trips the limit.
  const rate = Math.max(1, parseInt(opts.rate || '50', 10));
  const minSpacingMs = 60000 / rate;
  let nextSlot = 0;
  const gate = async () => {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + minSpacingMs;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };

  const client = new GlueAPIClient();

  // 1. Enumerate recent threads (GraphQL, read-only).
  const result = await client.searchThreads({ order: 'lastMessage', last: threadsToScan });
  const threads: Array<{ id: string; subject: string | null }> = (result.edges || []).map(
    (e: any) => ({ id: e.node.id, subject: e.node.subject ?? null }),
  );

  // 2. For each thread, read its GetStream channel and collect rename events.
  const stream = new StreamService(client, config.glue.userId);
  await stream.connect();

  let scanned = 0;
  let errored = 0;

  type Row = {
    threadId: string;
    currentSubject: string | null;
    renameCount: number;
    renames: RenameRecord[];
  };

  let rateLimited = 0;
  const isRateLimit = (e: any) => e?.code === 9 || /too many request/i.test(e?.message || '');

  const scanThread = async (t: { id: string; subject: string | null }): Promise<Row | null> => {
    try {
      let msgs: any[] | undefined;
      // Paced query with bounded backoff retry if we still trip the limit.
      for (let attempt = 0; attempt < 4; attempt++) {
        await gate();
        try {
          msgs = await stream.queryChannelMessages(t.id, msgLimit);
          break;
        } catch (e: any) {
          if (isRateLimit(e) && attempt < 3) {
            rateLimited++;
            await sleep(2000 * (attempt + 1));
            continue;
          }
          throw e;
        }
      }
      scanned++;
      const renames = (msgs ?? [])
        .map((m) => renameFromMessage(m))
        .filter((r): r is RenameRecord => r != null)
        // ensure threadId is populated even if cid was absent
        .map((r) => ({ ...r, threadId: r.threadId || t.id }))
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      if (renames.length === 0) return null;
      return {
        threadId: t.id,
        currentSubject: t.subject,
        renameCount: renames.length,
        renames,
      };
    } catch {
      errored++;
      return null;
    }
  };

  try {
    // The gate (above) paces query starts under the rate limit; concurrency just
    // overlaps the per-query latency within that paced throughput.
    const rows = await inBatches(threads, concurrency, scanThread);

    const renamed = rows.filter((r): r is Row => r != null)
      // most recent rename first
      .sort((a, b) => String(b.renames[b.renames.length - 1].at).localeCompare(
        String(a.renames[a.renames.length - 1].at)));

    const totalEvents = renamed.reduce((n, r) => n + r.renameCount, 0);

    if (r.format === 'pretty') {
      r.line(`Rename audit — scanned ${scanned} thread(s)${errored ? `, ${errored} unreadable` : ''}`);
      r.line(`Renamed threads: ${renamed.length} (${totalEvents} subject-change event(s))`);
      r.line('---');
      for (const item of renamed) {
        r.line(`\n${item.currentSubject || '(no subject)'}  [${item.threadId}]`);
        for (const ev of item.renames) {
          const date = ev.at ? new Date(ev.at).toLocaleString() : '';
          const who = ev.actor?.name || ev.actor?.id || 'Unknown';
          r.line(`  ✎ ${date}  ${who} → "${ev.newSubject}"`);
        }
      }
    } else {
      r.result(
        {
          scanned,
          unreadable: errored,
          rateLimitRetries: rateLimited,
          renamedThreadCount: renamed.length,
          totalRenameEvents: totalEvents,
          threads: renamed,
        });
    }
  } finally {
    await stream.disconnect();
  }
}
