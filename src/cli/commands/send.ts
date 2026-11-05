import { messageText } from '../read-file.js';
import { assertWritable, reportDryRun } from '../guardrails.js';
import * as fs from 'fs';
import * as path from 'path';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { confirmText } from '../confirm-text.js';
import { shouldUpdate, saveLastSent, DedupeMatch } from '../last-sent.js';
import { idFrom, resolveRecipient } from '../resolve.js';
import { similarityRatio, SIMILARITY_THRESHOLD } from '../similarity.js';
import { saveUndo } from '../undo.js';
import { UsageError } from '../../errors.js';

const PREVIEW_LEN = 80;

function preview(text: string | undefined, n = PREVIEW_LEN): string {
  if (!text) return '(unavailable)';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n) + '…';
}

function humanElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? '' : 's'} ago`;
}

function emitAmbiguousRefusal(match: DedupeMatch, newText: string, ratio: number): never {
  const pct = Math.round(ratio * 100);
  const lines = [
    'AMBIGUOUS SEND REFUSED — likely a different topic, not a correction.',
    '',
    'Previous message:',
    `  id:        ${match.messageId}`,
    `  sent:      ${humanElapsed(match.elapsedMs)}`,
    `  preview:   "${preview(match.previousText)}"`,
    '',
    `New message (similarity ${pct}%):`,
    `  preview:   "${preview(newText)}"`,
    '',
    'Reflect: is this a correction, or a new message on a new topic?',
    '  --new                Post as a new message',
    '  --update             Replace the previous message (was the implicit behavior)',
    `  glue edit ${match.messageId} "<text>"   Replace a specific message by ID`,
    '',
    'Re-run with one of these flags to proceed.',
  ];
  console.error(lines.join('\n'));
  process.exit(2);
}

export async function sendCommand(textArg: string | undefined, opts: {
  textFile?: string;
  thread?: string;
  to?: string[];
  subject?: string;
  attach?: string[];
  pretty?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
  json?: boolean;
  new?: boolean;
  update?: boolean;
  chat?: boolean;
}) {
  const r = reporter(opts);
  assertWritable(opts);
  const text = await messageText(textArg, opts);
  validateConfig();
  const client = new GlueAPIClient();

  // Must specify either --thread or --to
  if (!opts.thread && (!opts.to || opts.to.length === 0)) {
    throw new UsageError('specify --thread <id> to reply, or --to <name> to start a new thread');
  }

  if (opts.new && opts.update) {
    throw new UsageError('--new and --update are mutually exclusive');
  }

  // Guard: never post a loose chat message into a group's main timeline.
  // A group link (`thr_…` with threadType: "groupChat") is the group's running
  // chat, NOT a discrete thread. `--thread <groupChatId>` drops a loose message
  // that scatters in the channel feed — the "individual message" we want to avoid.
  // A real, subject-titled thread inside a group is only created via
  // `--to <grp_…> --subject …`. Recover the grp_ id and hand back the exact fix.
  // `--chat` is the explicit opt-in for the rare time a loose chat message is wanted.
  if (opts.thread) opts.thread = idFrom(opts.thread, 'thr');

  if (opts.thread && !opts.chat) {
    const target = await client.getThread(opts.thread, 1);
    if (target.threadType === 'groupChat') {
      const groupId = target.recipients?.edges?.find(e => e.node.id.startsWith('grp_'))?.node.id;
      const groupLabel = target.subject || 'this group';
      const lines = [
        'REFUSED — --thread points at a GROUP CHAT, not a thread.',
        '',
        `"${groupLabel}" is the group's main chat timeline (threadType: groupChat).`,
        'Sending here posts a loose chat message that scatters in the channel feed —',
        'NOT a discrete, subject-titled thread inside the group.',
        '',
        'Start a real thread in the group instead:',
        groupId
          ? `  glue send "<text>" --to ${groupId} --subject "<subject>"`
          : '  glue send "<text>" --to <grp_…> --subject "<subject>"   (get the id from `glue groups`)',
        '',
        'Only if you truly want a loose message in the running chat, re-run with --chat.',
      ];
      console.error(lines.join('\n'));
      process.exit(2);
    }
  }

  const finalText = opts.yes ? text : await confirmText(text);
  if (finalText === null) {
    r.warn('Message cancelled.');
    return;
  }

  // Resolve --to names to user IDs
  let recipientIds: string[] | undefined;
  if (opts.to && opts.to.length > 0) {
    recipientIds = await Promise.all(opts.to.map(n => resolveRecipient(client, n)));
  }

  // Dedupe decision: --new bypasses entirely; otherwise look up the candidate.
  const candidate = opts.new ? null : shouldUpdate(opts.thread, recipientIds);

  // Similarity gate: if a candidate exists and the user did not opt into --update,
  // only auto-update when bodies are similar enough to look like a revision.
  let doUpdate = false;
  if (candidate) {
    if (opts.update) {
      doUpdate = true;
    } else {
      const ratio = candidate.previousText != null
        ? similarityRatio(candidate.previousText, finalText)
        : 1; // legacy entry without recorded text — fall through to old behavior
      if (ratio >= SIMILARITY_THRESHOLD) {
        doUpdate = true;
      } else {
        emitAmbiguousRefusal(candidate, finalText, ratio);
      }
    }
  }

  const destination = opts.thread ? `thread ${opts.thread}` : `new thread to ${opts.to!.join(', ')}`;
  if (reportDryRun(
    opts,
    r,
    doUpdate && candidate
      ? `Would replace message ${candidate.messageId}: ${finalText}`
      : `Would send to ${destination}: ${finalText}`,
  )) return;

  if (doUpdate && candidate) {
    if (candidate.previousText != null) {
      saveUndo(candidate.messageId, candidate.previousText, candidate.threadId);
    }
    const updated = await client.updateMessage(candidate.messageId, finalText);
    console.error(`Updated message ${candidate.messageId} (sent within last 5 min)`);
    saveLastSent(updated.id, updated.threadID, recipientIds, finalText);

    if (r.format === 'pretty') {
      r.line(`Thread: ${candidate.threadId}`);
      r.line(`Message ID: ${updated.id}`);
      r.line(`Text: ${updated.text}`);
    } else {
      r.result(updated);
    }
  } else {
    // Upload attachments if any
    let attachmentIds: string[] = [];
    if (opts.attach && opts.attach.length > 0) {
      for (const filePath of opts.attach) {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
          throw new UsageError(`Attachment file not found: ${resolved}`, `Verify the path is correct and absolute. --attach takes local file paths, not URLs or Glue file IDs. Tilde expansion only works if your shell expanded it before passing the arg.`);
        }
        if (!fs.statSync(resolved).isFile()) {
          throw new UsageError(`--attach cannot read "${resolved}": it is a folder, not a file.`);
        }
        console.error(`Uploading ${path.basename(resolved)}...`);
        const fileId = await client.uploadFile(resolved);
        attachmentIds.push(fileId);
        console.error(`  Uploaded: ${fileId}`);
      }
    }

    const response = await client.sendMessage({
      threadId: opts.thread,
      recipients: recipientIds,
      subject: opts.subject,
      text: finalText,
      attachments: attachmentIds.length > 0 ? attachmentIds : undefined,
    });

    // Track this send for potential update
    saveLastSent(response.message.id, response.thread.id, recipientIds, finalText);

    if (r.format === 'pretty') {
      const msg = response.message;
      r.line(`Sent to thread: ${response.thread.subject || '(No subject)'} (${response.thread.id})`);
      r.line(`Message ID: ${msg.id}`);
      r.line(`Text: ${msg.text}`);
    } else {
      r.result(response);
    }
  }
}
