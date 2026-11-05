import { messageText } from '../read-file.js';
import { assertWritable, reportDryRun } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { config, validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { confirmText } from '../confirm-text.js';
import { resolveRecipient } from '../resolve.js';
import { UsageError } from '../../errors.js';

// Start a thread within a thread. Glue has two kinds, and the anchor ID picks
// which one:
//
// - thr_… — a SUBTHREAD: a new thread inside a whole thread (the composer's
//   "Thread" button). The new thread gets Thread.parentThread and no anchor
//   message. This is sendDraft with the parent thread listed as a recipient.
// - msg_… — a BRANCH: a new thread started off one message ("reply in
//   thread"). It links back to the anchor via Thread.replyToMessage, and the
//   anchor gains a Message.replyThreadID pointer. This is sendMessage with
//   `thread.replyToMessageID` set.
export async function subthreadCommand(anchorId: string, textArg: string | undefined, opts: {
  textFile?: string;
  to?: string[];
  subject?: string;
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

  if (anchorId.startsWith('thr_')) {
    await subthreadInThread(client, anchorId, text, opts);
    return;
  }

  const messageId = anchorId;
  if (!messageId.startsWith('msg_')) {
    throw new UsageError(`subthread expects a message ID (msg_…) or a thread ID (thr_…), got "${messageId}"`, `Pass thr_… to start a subthread inside that thread, or msg_… to start a branch off that message. ` +
        `Find IDs with: glue threads --search "<subject>" (thread IDs) or glue thread <thr_…> (the .messages[].id field).`);
  }

  const anchor = await client.getMessage(messageId);
  if (!anchor) {
    throw new UsageError(`message not found: ${messageId}`, `Confirm the ID with: glue message ${messageId}. Anchor message IDs come from glue thread <thr_…> (the .messages[].id field), not from a URL.`);
  }

  // Recipients: explicit --to names, otherwise inherit the parent thread's recipients.
  let recipientIds: string[];
  if (opts.to && opts.to.length > 0) {
    recipientIds = await Promise.all(opts.to.map(n => resolveRecipient(client, n)));
  } else {
    const parent = await client.getThread(anchor.threadID, 1);
    recipientIds = (parent.recipients?.edges || []).map((e: any) => e.node.id);
    if (recipientIds.length === 0) {
      throw new UsageError(`could not inherit recipients from parent thread ${anchor.threadID}`, `Pass recipients explicitly: glue subthread ${messageId} "<text>" --to "<name>". ` +
          `--to resolves PERSON names only; to include a group, pass its grp_… ID (get it from glue groups).`);
    }
  }

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Branch cancelled.');
    return;
  }

  if (reportDryRun(opts, r, `Would start a branch off ${messageId}: ${finalText}`)) return;

  const response = await client.sendMessage({
    recipients: recipientIds,
    subject: opts.subject,
    text: finalText,
    replyToMessageID: messageId,
  });

  if (r.format === 'pretty') {
    r.line(`Started branch: ${response.thread.subject || '(No subject)'} (${response.thread.id})`);
    r.line(`Off message: ${messageId} (in thread ${anchor.threadID})`);
    r.line(`Message ID: ${response.message.id}`);
    r.line(`Text: ${response.message.text}`);
  } else {
    r.result({ ...response, anchorMessageId: messageId, parentThreadId: anchor.threadID });
  }
}

// Start a subthread inside `parentId` — what the web composer's "Thread" button does.
async function subthreadInThread(client: GlueAPIClient, parentId: string, text: string, opts: {
  to?: string[];
  subject?: string;
  yes?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  json?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  assertWritable(opts);
  const parent = await client.getThread(parentId, 1).catch(() => null);
  if (!parent?.id) {
    throw new UsageError(`thread not found: ${parentId}`, `Confirm the ID with: glue thread ${parentId}. Thread IDs come from glue threads, or from the thr_… part of a Glue URL.`);
  }

  // Recipients: explicit --to names, otherwise the parent's recipients with the
  // subscription each holds on the parent — the same list the web app sends.
  // The parent thread itself is always added by createSubthread.
  let recipientRoles: Array<{ recipient: string; subscription: string }>;
  if (opts.to && opts.to.length > 0) {
    const ids = await Promise.all(opts.to.map(n => resolveRecipient(client, n)));
    recipientRoles = ids.map(id => ({ recipient: id, subscription: 'inbox' }));
  } else {
    const me = config.glue.userId;
    recipientRoles = (await client.getThreadRecipientRoles(parentId))
      .filter(r => r.id !== me)
      .map(r => ({ recipient: r.id, subscription: r.subscription ?? 'inbox' }));
  }

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Subthread cancelled.');
    return;
  }

  if (reportDryRun(opts, r, `Would start a subthread in ${parentId}: ${finalText}`)) return;

  const thread = await client.createSubthread({
    parentThreadId: parentId,
    recipientRoles,
    subject: opts.subject,
    text: finalText,
  });

  if (r.format === 'pretty') {
    r.line(`Started subthread: ${thread.subject || '(No subject)'} (${thread.id})`);
    r.line(`Inside thread: ${parent.subject || '(No subject)'} (${parentId})`);
    r.line(`Message ID: ${thread.firstMessage?.id}`);
    r.line(`Text: ${thread.firstMessage?.text}`);
  } else {
    r.result({ thread, parentThreadId: parentId });
  }
}
