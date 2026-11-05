import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { getCache } from '../../services/cache.js';
import { UsageError } from '../../errors.js';

function parsePositive(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new UsageError(`--last must be a whole number above 0, got "${value}"`);
  }
  return n;
}

function regularThreads(edges: any[], recipientId: string): any[] {
  return edges.filter(
    (edge: any) =>
      edge.node.threadType !== 'groupChat' &&
      edge.node.recipients.edges.some((r: any) => r.node.id === recipientId),
  );
}

export async function threadsCommand(opts: {
  group?: string;
  search?: string;
  messages?: string;
  author?: string;
  last?: string;
  order?: string;
  excludeChats?: boolean;
  all?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();

  // Resolve group name to ID if provided
  let recipientId: string | undefined;
  let groupDisplayName: string | undefined;
  if (opts.group) {
    const cache = getCache();
    recipientId = opts.group.startsWith('grp_') ? opts.group : cache.getGroup(opts.group) ?? undefined;
    if (!recipientId) {
      const groups = await client.searchGroups(opts.group);
      const match = groups.edges[0]?.node;
      if (!match) {
        const msg = { error: true, message: `No group found matching "${opts.group}"` };
        throw new UsageError(r.format === 'pretty' ? msg.message : JSON.stringify(msg));
      }
      recipientId = match.id;
      groupDisplayName = match.name;
      cache.setGroup(opts.group, match.id);
    }
    if (r.format === 'pretty') {
      r.line(`Group: ${groupDisplayName || opts.group} (${recipientId})\n`);
    }
  }

  let result: any;

  if (recipientId) {
    // Paginate through all API results, then post-filter to direct recipients only
    // Each page runs oldest to newest, and `before` walks to older pages. With --last, stop as soon
    // as enough threads are in hand. Without it, a group lists all of its threads.
    const limit = opts.last ? parsePositive(opts.last) : undefined;
    let allEdges: any[] = [];
    let before: string | undefined;
    let totalCount = 0;

    while (true) {
      const page = await client.searchThreads({
        match: opts.search,
        matchMessages: opts.messages,
        recipientId,
        excludeChats: opts.excludeChats,
        order: (opts.order as any) || 'lastMessage',
        last: 500,
        before,
      });
      totalCount = page.totalCount;
      const pageEdges = limit === undefined ? page.edges : page.edges.concat(allEdges);
      allEdges = limit === undefined ? allEdges.concat(page.edges) : pageEdges;

      if (!page.pageInfo.hasPreviousPage) break;
      if (limit !== undefined && regularThreads(allEdges, recipientId).length >= limit) break;
      before = page.pageInfo.startCursor;
    }

    // Post-filter: only keep threads where the group is a direct recipient
    const directEdges = allEdges.filter((edge: any) =>
      edge.node.recipients.edges.some((r: any) => r.node.id === recipientId)
    );

    // Separate group chat from regular threads
    const groupChatEdge = directEdges.find((e: any) => e.node.threadType === 'groupChat');
    const regular = directEdges.filter((e: any) => e.node.threadType !== 'groupChat');
    const regularEdges = limit === undefined ? regular : regular.slice(-limit);

    result = { edges: regularEdges, totalCount, groupChat: groupChatEdge?.node || null };
  } else if (opts.all) {
    // Paginate through every page via the lastMessage cursor.
    // The server caps each page at ~500; `before: startCursor` walks older.
    let allEdges: any[] = [];
    let before: string | undefined;
    let totalCount = 0;

    while (true) {
      const page = await client.searchThreads({
        match: opts.search,
        matchMessages: opts.messages,
        excludeChats: opts.excludeChats,
        order: (opts.order as any) || 'lastMessage',
        last: 500,
        before,
      });
      totalCount = page.totalCount;
      allEdges = allEdges.concat(page.edges);

      if (!page.pageInfo.hasPreviousPage) break;
      before = page.pageInfo.startCursor;
    }

    result = { edges: allEdges, totalCount };
  } else {
    const limit = parsePositive(opts.last ?? '20');
    result = await client.searchThreads({
      match: opts.search,
      matchMessages: opts.messages,
      recipientId,
      excludeChats: opts.excludeChats,
      order: (opts.order as any) || 'lastMessage',
      last: limit,
    });
    // The server can answer with one more than asked, so hold the count here.
    result = { ...result, edges: result.edges.slice(-limit) };
  }

  // Client-side author filter on matched messages
  let matchedMessages = result.matchedMessages?.edges || [];
  if (opts.author) {
    const authorLower = opts.author.toLowerCase();
    matchedMessages = matchedMessages.filter(
      (e: any) => e.node.user.name.toLowerCase().includes(authorLower)
    );
  }
  const matchedCount = opts.author ? matchedMessages.length : (result.matchedMessages?.totalCount || 0);

  if (r.format === 'pretty') {
    const filters: string[] = [];
    if (opts.search) filters.push(`Subject: "${opts.search}"`);
    if (opts.messages) filters.push(`Messages: "${opts.messages}"`);
    if (opts.author) filters.push(`Author: "${opts.author}"`);
    if (filters.length) r.line(`Filters: ${filters.join(', ')}`);

    // Show group chat separately at the top
    if (result.groupChat) {
      const gc = result.groupChat;
      const msgCount = gc.lastMessage ? '' : ' (no messages)';
      r.line(`Group chat: ${gc.subject || '(No subject)'} (${gc.id})${msgCount}`);
      if (gc.lastMessage) {
        r.line(`  Last: ${gc.lastMessage.user.name}: ${gc.lastMessage.textPreview} (${new Date(gc.lastMessage.createdAt).toLocaleDateString()})`);
      }
      r.line('');
    }

    const showingCount = result.edges.length;
    const countStr = recipientId
      ? `Threads: ${showingCount} direct (${result.totalCount} from API)\n`
      : `Threads: ${result.totalCount} total, showing ${showingCount}\n`;
    r.line(countStr);
    for (const edge of result.edges) {
      const t = edge.node;
      const groups = t.recipients.edges
        .filter((r: any) => r.node.id.startsWith('grp_'))
        .map((r: any) => r.node.name);
      const groupStr = groups.length > 0 ? ` [${groups.join(', ')}]` : '';
      const lastMsg = t.lastMessage;
      const lastMsgStr = lastMsg
        ? `  Last: ${lastMsg.user.name}: ${lastMsg.textPreview} (${new Date(lastMsg.createdAt).toLocaleDateString()})`
        : '';

      r.line(`  ${t.subject || '(No subject)'}${groupStr}`);
      r.line(`  ID: ${t.id}  Type: ${t.threadType}${t.closedAt ? '  CLOSED' : ''}`);
      if (lastMsgStr) r.line(lastMsgStr);
      r.line('');
    }

    if (matchedCount > 0) {
      r.line(`--- Matched messages: ${matchedCount} ---\n`);
      for (const edge of matchedMessages.slice(0, 10)) {
        const m = edge.node;
        r.line(`  ${m.user.name}: ${m.textPreview}`);
        r.line(`    Thread: ${m.threadId}  ${new Date(m.createdAt).toLocaleString()}`);
        r.line('');
      }
      if (matchedCount > 10) {
        r.line(`  ... and ${matchedCount - 10} more\n`);
      }
    }
  } else {
    const out: any = {
      threads: result.edges.map((e: any) => ({
        ...e.node,
        recipients: e.node.recipients.edges.map((r: any) => r.node),
      })),
      totalCount: result.totalCount,
    };
    if (result.groupChat) {
      out.groupChat = {
        ...result.groupChat,
        recipients: result.groupChat.recipients.edges.map((r: any) => r.node),
      };
    }
    if (matchedCount > 0) {
      out.matchedMessages = matchedMessages.map((e: any) => e.node);
      out.matchedMessagesCount = matchedCount;
    }
    r.result(out);
  }
}
