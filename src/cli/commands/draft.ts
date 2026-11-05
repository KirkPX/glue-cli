import { messageText } from '../read-file.js';
import { assertWritable, reportDryRun, type GuardOptions, confirmOrAbort } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { resolveRecipient } from '../resolve.js';
import { UsageError } from '../../errors.js';

// glue draft-save "<text>" --to <names...> [--subject] [--reply-to <msg>] [--id <draftId>]
export async function draftSaveCommand(textArg: string | undefined, opts: {
  textFile?: string;
  dryRun?: boolean; readOnly?: boolean; json?: boolean; yes?: boolean; to?: string[]; subject?: string; replyTo?: string; id?: string; 
}) {
  const r = reporter(opts);
  assertWritable(opts);
  const text = await messageText(textArg, opts);
  if (reportDryRun(opts, r, `Would save a draft: ${text}`)) return;
  validateConfig();
  const client = new GlueAPIClient();

  let recipientIds: string[] = [];
  if (opts.to && opts.to.length > 0) {
    recipientIds = await Promise.all(opts.to.map(n => resolveRecipient(client, n)));
  } else if (!opts.id) {
    throw new UsageError('a new draft needs recipients', 'Pass --to "<name>" (person) or a grp_… ID. Updating an existing draft? pass --id <dft_…>.');
  }

  const draft = await client.saveDraft({
    draftId: opts.id,
    recipients: recipientIds,
    subject: opts.subject,
    text,
    replyToMessageID: opts.replyTo,
  });

  if (r.format === 'pretty') {
    r.line(`Saved draft: ${draft.subject || '(No subject)'} (${draft.id})`);
    r.line(`  ${draft.message?.textPreview || ''}`);
  } else {
    r.result(draft);
  }
}

// glue draft-send <draftId> — rebuilds the input from the stored draft and sends it.
export async function draftSendCommand(draftId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would send draft ${draftId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();

  const draft = await client.getDraft(draftId);
  if (!draft) {
    throw new UsageError(`draft not found: ${draftId}`, 'List drafts with: glue drafts. IDs look like dft_….');
  }

  const result = await client.sendDraft({
    draftId,
    recipients: (draft.recipients || []).map((r: any) => r.id),
    subject: draft.subject,
    text: draft.message?.text || '',
    attachments: (draft.message?.attachments || []).map((a: any) => a.id),
  });

  if (r.format === 'pretty') {
    r.line(`Sent draft ${draftId} → thread ${result.id} (${result.subject || 'No subject'})`);
  } else {
    r.result(result);
  }
}

// glue draft-delete <draftId>
export async function draftDeleteCommand(draftId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would delete draft ${draftId}`)) return;
  if (!(await confirmOrAbort(`Delete draft ${draftId}?`, opts, r))) return;
  validateConfig();
  const client = new GlueAPIClient();
  const ok = await client.deleteDraft(draftId);
  if (r.format === 'pretty') {
    r.line(ok ? `Deleted draft ${draftId}` : `Draft not deleted: ${draftId}`);
  } else {
    r.result({ deleted: ok, id: draftId });
  }
}
