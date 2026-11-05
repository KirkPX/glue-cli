import { messageText } from '../read-file.js';
import { assertWritable, reportDryRun } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { confirmText } from '../confirm-text.js';
import { saveUndo } from '../undo.js';

export async function editCommand(messageId: string, textArg: string | undefined, opts: {
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

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Edit cancelled.');
    return;
  }

  if (reportDryRun(opts, r, `Would replace message ${messageId}: ${finalText}`)) return;

  // Capture the prior body into the undo store before overwriting.
  // One extra roundtrip; worth it so `glue restore <id>` always works.
  try {
    const prior = await client.getMessage(messageId);
    if (prior && typeof prior.text === 'string') {
      saveUndo(messageId, prior.text, prior.threadID);
    }
  } catch {
    // Best-effort backup — if the lookup fails we still let the edit proceed.
  }

  const updated = await client.updateMessage(messageId, finalText);

  if (r.format === 'pretty') {
    r.line(`Edited message ${updated.id}`);
    r.line(`Thread: ${updated.threadID}`);
    r.line(`Text: ${updated.text}`);
  } else {
    r.result(updated);
  }
}
