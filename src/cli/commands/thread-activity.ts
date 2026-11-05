import { idFrom } from '../resolve.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig, config } from '../../config.js';
import { reporter } from '../output.js';
import { StreamService } from '../../client-realtime.js';
import { parseNewSubject } from '../rename.js';

// Activity / timeline events (rename, "replied with sub-thread", etc.) are NOT
// exposed by the Glue GraphQL API — the `node(Thread).messages` connection that
// `glue thread` reads returns only real user messages (`type: regular`). The web
// app's timeline renders these events from the thread's GetStream channel, where
// each event is a message with `type: "system"`. This command reads that channel
// via the CLI's existing StreamService (auth = the stream token derived from the
// CLI's own Bearer token, same as `glue react` / `glue watch`).
//
// A subject-change event looks like:
//   { type: "system", text: 'Alex Example changed the subject to "Roadmap"',
//     created_at: "2026-06-13T17:21:40Z", user: { id, name } }

export async function threadActivityCommand(idOrLink: string, opts: {
  limit?: string;
  renames?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  const id = idFrom(idOrLink, 'thr');
  validateConfig();
  const threadId = id.startsWith('thr_') ? id : `thr_${id}`;
  const limit = parseInt(opts.limit || '200', 10);

  const client = new GlueAPIClient();
  const stream = new StreamService(client, config.glue.userId);
  await stream.connect();

  try {
    const all = await stream.queryChannelMessages(threadId, limit);

    let events = all
      .filter((m) => m.type === 'system')
      .map((m) => {
        const newSubject = parseNewSubject(m.text);
        return {
          id: m.id,
          type: m.type as string,
          text: m.text as string,
          createdAt: m.created_at,
          user: m.user ? { id: m.user.id, name: m.user.name } : null,
          isSubjectChange: newSubject != null,
          newSubject,
        };
      })
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

    if (opts.renames) {
      events = events.filter((e) => e.isSubjectChange);
    }

    if (r.format === 'pretty') {
      r.line(`Thread activity: ${threadId}`);
      r.line(`Events: ${events.length}${opts.renames ? ' (subject changes only)' : ''}`);
      r.line('---');
      for (const e of events) {
        const date = e.createdAt ? new Date(e.createdAt).toLocaleString() : '';
        const who = e.user?.name || e.user?.id || 'Unknown';
        if (e.isSubjectChange) {
          r.line(`${date}  ✎ ${who} → subject "${e.newSubject}"`);
        } else {
          r.line(`${date}  • ${e.text}`);
        }
      }
    } else {
      r.result(
        {
          threadId,
          fetched: all.length,
          eventCount: events.length,
          events,
        });
    }
  } finally {
    await stream.disconnect();
  }
}
