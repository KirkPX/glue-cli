import { assertWritable, confirmOrAbort, reportDryRun } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { loadUndo, deleteUndo } from '../undo.js';

export async function restoreCommand(messageId: string, opts: {
  yes?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  json?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  assertWritable(opts);
  validateConfig();

  const record = loadUndo(messageId);
  if (!record) {
    throw new UsageError(`No undo entry found for ${messageId}. Undo files expire after 7 days.`);
  }

  const before = record.previousText.replace(/\s+/g, ' ').slice(0, 200);
  if (reportDryRun(opts, r, `Would restore message ${messageId} to: ${before}`)) return;
  if (!(await confirmOrAbort(`Restore ${messageId} to:\n  "${before}"\nProceed?`, opts, r))) return;

  const client = new GlueAPIClient();
  const updated = await client.updateMessage(messageId, record.previousText);
  deleteUndo(messageId);

  if (r.format === 'pretty') {
    r.line(`Restored message ${updated.id}`);
    r.line(`Thread: ${updated.threadID}`);
    r.line(`Text: ${updated.text}`);
  } else {
    r.result(updated);
  }
}
