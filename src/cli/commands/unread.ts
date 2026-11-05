import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function unreadCommand(opts: { pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const counts = await client.getMailboxCounts();

  if (r.format === 'pretty') {
    r.line(`Unread inbox:     ${counts.unreadInbox}`);
    r.line(`Mentions:         ${counts.mentioned}`);
    r.line(`Unseen activity:  ${counts.unseenActivity}`);
  } else {
    r.result(counts);
  }
}
