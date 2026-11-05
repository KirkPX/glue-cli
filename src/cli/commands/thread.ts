import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { idFrom } from '../resolve.js';

export async function threadCommand(idOrLink: string, opts: { limit?: string; oldest?: boolean; pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const id = idFrom(idOrLink, 'thr');
  const limit = parseInt(opts.limit || '100', 10);
  // Default to the newest N messages (the tail of the conversation). --oldest
  // flips to the first N, the original behavior.
  const direction = opts.oldest ? 'oldest' : 'newest';
  const thread = await client.getThread(id, limit, { direction });

  const recipients = thread.recipients?.edges?.map((e: any) => e.node) || [];
  // Display chronologically (oldest first, newest at the bottom) regardless of
  // which end we fetched.
  const sorted = thread.messages.edges
    .map((e: any) => e.node)
    .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt));
  // The server can answer with one more than asked, so hold the count here.
  const messages = opts.oldest ? sorted.slice(0, limit) : sorted.slice(-limit);

  if (r.format === 'pretty') {
    const recipientNames = recipients.map((r: any) =>
      r.id.startsWith('grp_') ? `[${r.name}]` : r.name
    );
    r.line(`Thread: ${thread.subject || '(No subject)'} (${thread.id})`);
    if (thread.threadType) r.line(`Type: ${thread.threadType}`);
    if (thread.replyToMessage) {
      const anchor = thread.replyToMessage;
      const preview = (anchor.textPreview || '').replace(/\n/g, ' ').slice(0, 80);
      r.line(`Branch off ${anchor.user.name}'s message "${preview}" (${anchor.id} in ${anchor.threadID})`);
    } else if (thread.parentThread) {
      const p = thread.parentThread;
      r.line(`Subthread of: ${p.subject || '(No subject)'} (${p.id})`);
    }
    r.line(`Recipients: ${recipientNames.join(', ') || 'none'}`);
    r.line(`Messages: ${messages.length}`);
    r.line('---');
    for (const m of messages) {
      const date = new Date(m.createdAt).toLocaleString();
      r.line(`\n${m.user.name} (${date}):`);
      if (m.quotedMessage) {
        const q = m.quotedMessage;
        const preview = (q.textPreview || q.text || '').replace(/\n/g, ' ').slice(0, 80);
        r.line(`  ↪ replying to ${q.user.name}: "${preview}" (${q.id})`);
      }
      r.line(m.text);
      if (m.replyThreadID) {
        r.line(`  ⤷ has branch: ${m.replyThreadID}`);
      }
    }
  } else {
    r.result({
      id: thread.id,
      subject: thread.subject,
      createdAt: thread.createdAt,
      threadType: thread.threadType,
      parentThread: thread.parentThread ?? null,
      replyToMessage: thread.replyToMessage ?? null,
      recipients,
      messages,
    });
  }
}
