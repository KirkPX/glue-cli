import { assertWritable, reportDryRun } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig, config } from '../../config.js';
import { reporter } from '../output.js';
import { StreamService } from '../../client-realtime.js';

export async function reactCommand(messageId: string, type: string, opts: {
  remove?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  json?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would ${opts.remove ? 'remove' : 'add'} reaction :${type}: on ${messageId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const msg = await client.getMessage(messageId);

  if (!msg) {
    throw new UsageError(`message not found: ${messageId}`);
  }
  if (!msg.streamID || !msg.threadID) {
    throw new UsageError(`message ${messageId} is missing stream metadata`);
  }

  const stream = new StreamService(client, config.glue.userId);
  await stream.connect();
  try {
    const result = opts.remove
      ? await stream.deleteReaction(msg.threadID, msg.streamID, type)
      : await stream.sendReaction(msg.threadID, msg.streamID, type);

    if (r.format === 'pretty') {
      r.line(`${opts.remove ? 'Removed' : 'Added'} reaction :${type}: on ${messageId}`);
    } else {
      r.result({ messageId, streamID: msg.streamID, type, action: opts.remove ? 'removed' : 'added', result });
    }
  } finally {
    await stream.disconnect();
  }
}
