import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function chatsCommand(opts: { type?: string; last?: string; order?: string; pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const chatType = (opts.type === 'user' ? 'user' : 'group') as 'group' | 'user';
  const last = parseInt(opts.last || '30', 10);
  const result = await client.getPersistentChats(chatType, last, opts.order || 'unread');
  // Glue answers `last: n` with n + 1 chats, so the newest n are kept here.
  const nodes = (result.edges || []).map((e: any) => e.node).slice(-last);

  if (r.format === 'pretty') {
    r.line(`${chatType === 'user' ? 'Direct' : 'Group'} chats: ${result.totalCount}`);
    r.line('---');
    for (const c of nodes) {
      const last = c.lastMessage;
      r.line(`\n${c.subject || '(No subject)'} (${c.id})`);
      if (last) {
        r.line(`  ${last.user?.name || '?'}: ${last.textPreview || ''}`);
      }
    }
  } else {
    r.result(nodes);
  }
}
