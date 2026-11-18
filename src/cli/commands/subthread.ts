import { messageText } from '../read-file.js';
import { assertWritable, reportDryRun } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { config, validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { confirmText } from '../confirm-text.js';
import { resolveRecipient, splitWorkspace } from '../resolve.js';
import { assertGlueLinks } from '../glue-links.js';
import { makeNewThreadPublic } from './send.js';
import { isWorkspaceId } from '../../visibility.js';
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
  public?: boolean;
  private?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  json?: boolean;
  pretty?: boolean;
}) {
  const r = reporter(opts);
  assertWritable(opts);
  const text = await messageText(textArg, opts);
  assertGlueLinks(text);
  if (opts.public && opts.private) {
    throw new UsageError('cannot set both --public and --private');
  }
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

  // Recipients: explicit --to names, otherwise inherit the parent thread's recipients. The
  // workspace (which makes a thread public) never goes into sendMessage: it is added after the
  // send with the 'activity' subscription, so the branch does not land in every inbox.
  let recipientIds: string[];
  let makePublic = !!opts.public;
  if (opts.to && opts.to.length > 0) {
    const split = splitWorkspace(opts.to);
    makePublic ||= split.workspace;
    recipientIds = await Promise.all(split.others.map(n => resolveRecipient(client, n)));
  } else {
    const parent = await client.getThread(anchor.threadID, 1);
    const inherited: string[] = (parent.recipients?.edges || []).map((e: any) => e.node.id);
    makePublic ||= inherited.some(isWorkspaceId);
    recipientIds = inherited.filter(id => !isWorkspaceId(id));
    if (recipientIds.length === 0) {
      throw new UsageError(`could not inherit recipients from parent thread ${anchor.threadID}`, `Pass recipients explicitly: glue subthread ${messageId} "<text>" --to "<name>". ` +
          `--to resolves PERSON names only; to include a group, pass its grp_… ID (get it from glue groups).`);
    }
  }

  if (opts.private) makePublic = false;
  if (recipientIds.length === 0) {
    throw new UsageError('A branch needs at least one person or group as well as the workspace.');
  }

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Branch cancelled.');
    return;
  }
  assertGlueLinks(finalText);

  if (reportDryRun(opts, r, `Would start a ${makePublic ? 'public ' : ''}branch off ${messageId}: ${finalText}`)) return;

  const response = await client.sendMessage({
    recipients: recipientIds,
    subject: opts.subject,
    text: finalText,
    replyToMessageID: messageId,
  });
  if (makePublic) await makeNewThreadPublic(client, response.thread.id);

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
  public?: boolean;
  private?: boolean;
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
  // A public parent passes its workspace recipient on, so the subthread starts public too.
  // --public adds the workspace and --private leaves it out. The workspace always goes in
  // with the 'activity' subscription, never 'inbox'.
  let recipientRoles: Array<{ recipient: string; subscription: string }>;
  let makePublic = !!opts.public;
  if (opts.to && opts.to.length > 0) {
    const split = splitWorkspace(opts.to);
    makePublic ||= split.workspace;
    const ids = await Promise.all(split.others.map(n => resolveRecipient(client, n)));
    recipientRoles = ids.map(id => ({ recipient: id, subscription: 'inbox' }));
  } else {
    const me = config.glue.userId;
    const inherited = (await client.getThreadRecipientRoles(parentId)).filter(r => r.id !== me);
    makePublic ||= inherited.some(r => isWorkspaceId(r.id));
    recipientRoles = inherited
      .filter(r => !isWorkspaceId(r.id))
      .map(r => ({ recipient: r.id, subscription: r.subscription ?? 'inbox' }));
  }
  if (opts.private) makePublic = false;

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Subthread cancelled.');
    return;
  }
  assertGlueLinks(finalText);

  if (reportDryRun(opts, r, `Would start a ${makePublic ? 'public ' : ''}subthread in ${parentId}${makePublic ? ' (everyone in the workspace can open it)' : ''}: ${finalText}`)) return;

  if (makePublic) {
    const workspace = await client.getWorkspace();
    recipientRoles.push({ recipient: workspace.id, subscription: 'activity' });
  }
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
