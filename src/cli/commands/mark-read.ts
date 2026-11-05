import { assertWritable, confirmOrAbort, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

// glue mark-read <threadId...> [--unread]
export async function markReadCommand(threadIds: string[], opts: GuardOptions & { unread?: boolean;  }) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would mark ${threadIds.length} thread(s) ${opts.unread ? 'unread' : 'read'}`)) return;
  if (threadIds.length > 1 && !(await confirmOrAbort(`Change ${threadIds.length} threads?`, opts, r))) return;
  validateConfig();
  const client = new GlueAPIClient();
  const isRead = !opts.unread;
  const edges = await client.markThreadsRead(threadIds, isRead);

  if (r.format === 'pretty') {
    for (const e of edges) {
      r.line(`${e.isRead ? 'read' : 'unread'}: ${e.id}`);
    }
  } else {
    r.result(edges);
  }
}
