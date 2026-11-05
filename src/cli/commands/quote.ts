import { messageText } from '../read-file.js';
import { assertWritable, reportDryRun } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig, config } from '../../config.js';
import { reporter } from '../output.js';
import { StreamService } from '../../client-realtime.js';
import { confirmText } from '../confirm-text.js';

export async function quoteCommand(messageId: string, textArg: string | undefined, opts: {
  textFile?: string;
  yes?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  json?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  assertWritable(opts);
  const text = await messageText(textArg, opts);
  validateConfig();
  const client = new GlueAPIClient();
  const msg = await client.getMessage(messageId);

  if (!msg) {
    throw new UsageError(`message not found: ${messageId}`);
  }
  if (!msg.streamID || !msg.threadID) {
    throw new UsageError(`message ${messageId} is missing stream metadata`);
  }

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Quote cancelled.');
    return;
  }

  if (reportDryRun(opts, r, `Would quote message ${messageId}: ${finalText}`)) return;

  const stream = new StreamService(client, config.glue.userId);
  await stream.connect();
  try {
    const response = await stream.sendQuote(msg.threadID, msg.streamID, finalText);

    if (r.format === 'pretty') {
      r.line(`Sent quote-reply to thread ${msg.threadID}`);
      r.line(`Quoting: ${messageId}`);
      r.line(`Text: ${finalText}`);
    } else {
      r.result({ threadID: msg.threadID, quotedMessageId: messageId, quotedStreamID: msg.streamID, response });
    }
  } finally {
    await stream.disconnect();
  }
}
