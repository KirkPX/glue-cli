import { idFrom } from '../resolve.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function messageCommand(idOrLink: string, opts: { pretty?: boolean }) {
  const r = reporter(opts);
  const id = idFrom(idOrLink, 'msg');
  validateConfig();
  const client = new GlueAPIClient();
  const message = await client.getMessage(id);

  if (!message) {
    throw new UsageError(JSON.stringify({ error: true, message: `Message not found: ${id}` }));
  }

  if (r.format === 'pretty') {
    const date = new Date(message.createdAt).toLocaleString();
    const edited = message.updatedAt && message.updatedAt !== message.createdAt
      ? ` (edited ${new Date(message.updatedAt).toLocaleString()})`
      : '';
    r.line(`${message.user.name} (${date})${edited}:`);
    if (message.quotedMessage) {
      const q = message.quotedMessage;
      const preview = (q.textPreview || q.text || '').replace(/\n/g, ' ').slice(0, 120);
      r.line(`↪ replying to ${q.user.name}: "${preview}" (${q.id})`);
    }
    r.line(message.text);
    r.line(`\nThread: ${message.threadID}  Message: ${message.id}`);

    const reactions = message.reactions?.edges || [];
    if (reactions.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const item of reactions) {
        const emoji = item.node.type;
        if (!grouped[emoji]) grouped[emoji] = [];
        grouped[emoji].push(item.node.user.name);
      }
      const parts = Object.entries(grouped).map(([emoji, names]) => `${emoji} ${names.join(', ')}`);
      r.line(`Reactions: ${parts.join('  ')}`);
    }

    const attachments = message.attachments || [];
    if (attachments.length > 0) {
      r.line(`Attachments:`);
      for (const a of attachments) {
        r.line(`  ${a.name} (${a.contentType}) ${a.url}`);
      }
    }
  } else {
    r.result(message);
  }
}
