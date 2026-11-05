import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function notificationsCommand(opts: { feed?: string; pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const feed = await client.getNotifications(opts.feed || 'all');
  const edges = feed.edges || [];

  if (r.format === 'pretty') {
    r.line(`Notifications: ${feed.totalCount} total, ${feed.unreadCount} unread, ${feed.unseenCount} unseen`);
    r.line('---');
    for (const e of edges) {
      const mark = e.isRead ? '  ' : '● ';
      r.line(`${mark}${e.node.text}`);
    }
  } else {
    r.result(
      {
        totalCount: feed.totalCount,
        unreadCount: feed.unreadCount,
        unseenCount: feed.unseenCount,
        notifications: edges.map((e: any) => ({
          id: e.node.id,
          text: e.node.text,
          verb: e.node.verb,
          isRead: e.isRead,
          isSeen: e.isSeen,
          activityCount: e.node.activityCount,
          actorCount: e.node.actorCount,
        })),
      });
  }
}
