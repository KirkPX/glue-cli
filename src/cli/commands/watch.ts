import { reporter, type Reporter } from '../output.js';
import { validateConfig, config } from '../../config.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { StreamService } from '../../client-realtime.js';
import { renameFromEvent } from '../rename.js';
import type { Event } from 'stream-chat';

interface WatchOpts {
  pretty?: boolean;
  thread?: string;
  group?: string;
  renames?: boolean;
}

// In --renames mode, emit only subject-change events. A rename is a GetStream
// `type:"system"` message ("<Actor> changed the subject to \"<X>\"") and arrives
// as message.new (first rename) or message.updated (repeat rename) — we already
// subscribe to both. Returns true if it handled (printed or suppressed) a rename
// context, so the caller can skip the generic formatter.
function formatRename(event: Event, r: Reporter): void {
  const rename = renameFromEvent(event as any);
  if (!rename) return;
  if (r.format === 'pretty') {
    const date = rename.at ? new Date(rename.at).toLocaleTimeString() : '';
    const who = rename.actor?.name || rename.actor?.id || 'Unknown';
    r.line(`[${date}] ✎ ${who} renamed ${rename.threadId} → "${rename.newSubject}"`);
  } else {
    r.event(rename);
  }
}

function formatEvent(event: Event, r: Reporter): void {
  const msg = event.message;
  if (!msg) return;

  const anyMsg = msg as any;
  const quotedId = anyMsg.quoted_message_id || anyMsg.quoted_message?.id;
  const quoted = anyMsg.quoted_message
    ? {
        id: anyMsg.quoted_message.id,
        text: anyMsg.quoted_message.text,
        user: anyMsg.quoted_message.user
          ? { id: anyMsg.quoted_message.user.id, name: anyMsg.quoted_message.user.name }
          : undefined,
      }
    : undefined;

  if (r.format === 'pretty') {
    const user = msg.user?.name || msg.user?.id || 'Unknown';
    const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : '';
    const text = (msg.text || '').replace(/\n/g, ' ').slice(0, 200);
    const channel = event.channel_id || '';
    const type = event.type || '';
    const replyHint = quotedId
      ? ` ↪${quoted?.user?.name ? ` to ${quoted.user.name}` : ''}: "${(quoted?.text || '').replace(/\n/g, ' ').slice(0, 60)}" (${quotedId})`
      : '';

    if (type === 'message.new') {
      r.line(`[${time}] ${user} in ${channel}:${replyHint} ${text}`);
    } else if (type === 'message.updated') {
      r.line(`[${time}] ${user} edited in ${channel}:${replyHint} ${text}`);
    } else if (type === 'message.deleted') {
      r.line(`[${time}] ${user} deleted message in ${channel}`);
    } else {
      r.line(`[${time}] ${type}: ${user} in ${channel}`);
    }
  } else {
    // NDJSON — one JSON object per line
    r.event({
      type: event.type,
      channel_id: event.channel_id,
      channel_type: event.channel_type,
      message: msg ? {
        id: msg.id,
        text: msg.text,
        user: msg.user ? { id: msg.user.id, name: msg.user.name } : undefined,
        created_at: msg.created_at,
        updated_at: msg.updated_at,
        quoted_message_id: quotedId,
        quoted_message: quoted,
      } : undefined,
      created_at: event.created_at,
    });
  }
}

export async function watch(_: unknown, opts: WatchOpts) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const userId = config.glue.userId;
  const stream = new StreamService(client, userId);

  // Graceful shutdown
  const cleanup = async () => {
    if (r.format === 'pretty') process.stderr.write('\nDisconnecting...\n');
    await stream.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  if (r.format === 'pretty') process.stderr.write('Connecting to Stream...\n');
  await stream.connect();
  if (r.format === 'pretty') process.stderr.write('Connected. Watching for messages...\n\n');

  // If specific thread requested, watch just that channel
  if (opts.thread) {
    const threadId = opts.thread.startsWith('thr_') ? opts.thread : `thr_${opts.thread}`;
    await stream.watchChannel(threadId);
    if (r.format === 'pretty') process.stderr.write(`Watching thread ${threadId}\n\n`);
  } else {
    // Query user's channels to start receiving events
    const channels = await stream.queryChannels();
    if (r.format === 'pretty') process.stderr.write(`Watching ${channels.length} channels\n\n`);
  }

  if (opts.renames) {
    // Rename-only feed: subject changes arrive as system messages via
    // message.new / message.updated (and notification.message_new for channels
    // not actively watched — only relevant when watching broadly; a single
    // --thread is already fully covered by its own watchChannel(), so the
    // notification fallback would just leak renames from unrelated threads).
    if (r.format === 'pretty') process.stderr.write('Filtering to subject-change (rename) events only\n\n');
    const renameEvents = opts.thread
      ? ['message.new', 'message.updated']
      : ['message.new', 'message.updated', 'notification.message_new'];
    for (const eventType of renameEvents) {
      stream.on(eventType, (event) => formatRename(event, r));
    }
  } else {
    // Listen for message events
    const events = ['message.new', 'message.updated', 'message.deleted'];
    for (const eventType of events) {
      stream.on(eventType, (event) => formatEvent(event, r));
    }

    // Also listen for notification events (messages in channels not actively
    // watched). Only relevant when watching broadly — a single --thread is
    // already fully covered by its own watchChannel(), so subscribing here
    // too would leak messages from every other thread the user is in.
    if (!opts.thread) {
      stream.on('notification.message_new', (event) => formatEvent(event, r));
    }
  }

  // Keep process alive
  await new Promise(() => {});
}
