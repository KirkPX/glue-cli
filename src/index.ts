#!/usr/bin/env node
import { Command, Option } from 'commander';
import { count, positive } from './cli/parse.js';
import { setCacheDisabled } from './services/cache.js';

// Exit cleanly when a downstream consumer closes the pipe early (e.g. `glue … | head`).
// Without this, the next stdout/stderr write throws an uncaught EPIPE and the CLI dies
// with a stack trace / non-zero exit. Non-EPIPE stream errors still propagate.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

const program = new Command();

program
  .name('glue')
  .description('Glue Groups CLI — messaging, threads, reactions, edits. Run `glue guide` for a full agent-oriented reference.')
  .version('2.1.0')
  .option('--json', 'Print JSON, even at a terminal')
  .addOption(new Option('--pretty', 'Print readable text, even in a pipe').hideHelp())
  .option('--read-only', 'Refuse any command that would change data')
  .option('--verbose', 'Print diagnostic details on failure')
  .option('--no-cache', 'Bypass resolution cache');

program.hook('preAction', async () => {
  if (!program.opts().cache) {
    setCacheDisabled(true);
  }
  // Every command, including those that read no settings, finds its files in the right place.
  const { migrateLegacyConfig } = await import('./services/migrate.js');
  migrateLegacyConfig();
});

// Running `glue` bare signs you in if you never have, and otherwise shows what you can do.
program.action(async () => {
  const { isConfigured, loginCommand } = await import('./cli/commands/login.js');
  if (isConfigured()) {
    program.help();
    return;
  }
  await loginCommand(program.opts());
});

program
  .command('login')
  .description('Sign in, or show the sign-in when you already have one')
  .option('--status', 'Show the current sign-in')
  .option('--refresh', 'Renew the access token now')
  .option('--force', 'Sign in again, even if already signed in')
  .option('--paste', 'Enter the token in the terminal instead of a browser')
  .option('--email [address]', 'Sign in with a code Glue emails to you. No browser needed')
  .addOption(new Option('--token <refreshToken>', 'Refused, with the safe way to do this').hideHelp())
  .action(async (opts) => {
    const { loginCommand } = await import('./cli/commands/login.js');
    await loginCommand({ ...program.opts(), ...opts });
  });

program
  .command('logout')
  .description('Sign out and clear the saved sign-in')
  .action(async (opts) => {
    const { logoutCommand } = await import('./cli/commands/login.js');
    await logoutCommand({ ...program.opts(), ...opts });
  });

program
  .command('doctor')
  .description('Check the install, the settings file and the saved sign-in')
  .option('--install', 'Close with an install verdict (used by `npm run setup`)')
  .action(async (opts) => {
    const { doctorCommand } = await import('./cli/commands/doctor.js');
    await doctorCommand({ ...program.opts(), ...opts });
  });

program
  .command('auth')
  .description('Show or clear the saved sign-in, from a script')
  .option('--status', 'Show the current sign-in (default)')
  .option('--logout', 'Clear the saved sign-in')
  .action(async (opts) => {
    const { authCommand } = await import('./cli/commands/auth.js');
    await authCommand({ ...program.opts(), ...opts });
  });

const configCmd = program.command('config').description('Inspect the settings file');

configCmd
  .command('path')
  .description('Print where the settings file lives')
  .action(async (opts) => {
    const { configPath } = await import('./cli/commands/config.js');
    await configPath({ ...program.opts(), ...opts });
  });

configCmd
  .command('show')
  .description('Validate the settings file and print it')
  .action(async (opts) => {
    const { configShow } = await import('./cli/commands/config.js');
    await configShow({ ...program.opts(), ...opts });
  });

program
  .command('me')
  .description('Show authenticated user info')
  .action(async (opts) => {
    const { meCommand } = await import('./cli/commands/me.js');
    await meCommand({ ...program.opts(), ...opts });
  });

program
  .command('groups')
  .description('List all groups')
  .action(async (opts) => {
    const { groupsCommand } = await import('./cli/commands/groups.js');
    await groupsCommand({ ...program.opts(), ...opts });
  });

program
  .command('directory')
  .description('Browse the locally-accrued index of people and groups (fills in as you use the CLI)')
  .option('--refresh', 'Pull the full current group list from the server into the index')
  .option('--clear', 'Empty the local index')
  .action(async (opts) => {
    const { directoryCommand } = await import('./cli/commands/directory.js');
    await directoryCommand({ ...program.opts(), ...opts });
  });

program
  .command('threads')
  .description('List/search threads with server-side filtering')
  .option('--group <name>', 'Filter by group name')
  .option('--search <text>', 'Search thread subjects')
  .option('--messages <text>', 'Search message content')
  .option('--author <name>', 'Filter matched messages by author')
  .option('--last <n>', 'Number of threads to return (default: 20; with --group, every thread unless set)', positive)
  .option('--all', 'Paginate through ALL threads (ignores --last; walks past the ~500/page server cap)')
  .option('--order <order>', 'Sort order: lastMessage, created, unread', 'lastMessage')
  .option('--exclude-chats', 'Exclude DM/chat threads')
  .action(async (opts) => {
    const { threadsCommand } = await import('./cli/commands/threads.js');
    await threadsCommand({ ...program.opts(), ...opts });
  });

program
  .command('thread <id>')
  .description('View a thread and its messages')
  .option('--limit <n>', 'Max messages to fetch', positive, '100')
  .option('--oldest', 'Fetch the OLDEST messages (start of thread); default is the newest')
  .action(async (id, opts) => {
    const { threadCommand } = await import('./cli/commands/thread.js');
    await threadCommand(id, { ...program.opts(), ...opts });
  });

program
  .command('thread-activity <id>')
  .description('View a thread\'s activity timeline (subject changes, branch events) from its GetStream channel')
  .option('--limit <n>', 'Max channel messages to scan', positive, '200')
  .option('--renames', 'Show only subject-change events')
  .action(async (id, opts) => {
    const { threadActivityCommand } = await import('./cli/commands/thread-activity.js');
    await threadActivityCommand(id, { ...program.opts(), ...opts });
  });

program
  .command('rename-audit')
  .description('Sweep recent threads for subject-change (rename) history — for auditing naming-convention adoption')
  .option('--threads <n>', 'How many recent threads to scan', positive, '50')
  .option('--limit <n>', 'Max channel messages to scan per thread', positive, '200')
  .option('--concurrency <n>', 'How many thread channels to read in parallel', positive, '8')
  .option('--rate <perMin>', 'Max channel queries per minute (GetStream limits ~60/min; paced to avoid 429s)', positive, '50')
  .action(async (opts) => {
    const { renameAuditCommand } = await import('./cli/commands/rename-audit.js');
    await renameAuditCommand({ ...program.opts(), ...opts });
  });

program
  .command('message <id>')
  .description('View a single message by ID')
  .action(async (id, opts) => {
    const { messageCommand } = await import('./cli/commands/message.js');
    await messageCommand(id, { ...program.opts(), ...opts });
  });

program
  .command('delete-message <id>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .option('-y, --yes', 'Delete without asking')
  .description('Delete a message by ID (destructive)')
  .action(async (id, opts) => {
    const { deleteMessageCommand } = await import('./cli/commands/delete-message.js');
    await deleteMessageCommand(id, { ...program.opts(), ...opts });
  });

program
  .command('edit <id> [text]')
  .option('--text-file <path>', 'Read the text from a file, or - for standard input')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Edit an existing message')
  .option('-y, --yes', 'Send without asking')
  .action(async (id, text, opts) => {
    const { editCommand } = await import('./cli/commands/edit.js');
    await editCommand(id, text, { ...program.opts(), ...opts });
  });

program
  .command('react <id> <type>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Add a reaction to a message. Glue uses emoji-name types: +1, heart, joy, astonished, pensive, fire, etc. Use --remove to undo.')
  .option('--remove', 'Remove the reaction instead of adding it')
  .action(async (id, type, opts) => {
    const { reactCommand } = await import('./cli/commands/react.js');
    await reactCommand(id, type, { ...program.opts(), ...opts });
  });

program
  .command('quote <id> [text]')
  .option('--text-file <path>', 'Read the text from a file, or - for standard input')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Send a quote-reply that embeds the referenced message')
  .option('-y, --yes', 'Send without asking')
  .action(async (id, text, opts) => {
    const { quoteCommand } = await import('./cli/commands/quote.js');
    await quoteCommand(id, text, { ...program.opts(), ...opts });
  });

program
  .command('subthread <anchorId> [text]')
  .option('--text-file <path>', 'Read the text from a file, or - for standard input')
  .option('--dry-run', 'Report what would change, and change nothing')
  .summary('Start a subthread inside a thread (thr_…), or a branch off one message (msg_…)')
  .description([
    'Two kinds of thread-in-a-thread. The ID you pass picks the kind:',
    '  thr_… → SUBTHREAD: a new thread inside that thread (the composer\'s "Thread" button). Sets Thread.parentThread.',
    '  msg_… → BRANCH: a new thread started off ONE message (Glue "reply in thread"). Links Thread.replyToMessage ⇄ Message.replyThreadID.',
    'Inherits the parent thread\'s recipients unless --to is given.',
    '',
    'Pick the right command:',
    '  glue subthread <thr_…> "..."   → NEW subthread inside that thread',
    '  glue subthread <msg_…> "..."   → NEW branch off that message',
    '  glue quote <msg_…> "..."       → inline quote-reply in the SAME thread',
    '  glue send "..." --thread <thr_…> → plain reply into an existing thread',
  ].join('\n'))
  .option('--to <names...>', 'Recipients for the new thread (default: inherit parent thread). Person names; pass grp_… IDs for groups.')
  .option('--subject <subject>', 'Subject for the new thread (default: server-derived from the text)')
  .option('-y, --yes', 'Send without asking')
  .action(async (anchorId, text, opts) => {
    const { subthreadCommand } = await import('./cli/commands/subthread.js');
    await subthreadCommand(anchorId, text, { ...program.opts(), ...opts });
  });

program
  .command('pin <messageId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Pin a message')
  .action(async (messageId, opts) => {
    const { pinCommand } = await import('./cli/commands/pin.js');
    await pinCommand(messageId, { ...program.opts(), ...opts });
  });

program
  .command('unpin <messageId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Unpin a message')
  .action(async (messageId, opts) => {
    const { unpinCommand } = await import('./cli/commands/unpin.js');
    await unpinCommand(messageId, { ...program.opts(), ...opts });
  });

program
  .command('people <search>')
  .description('Search workspace members by name')
  .action(async (search, opts) => {
    const { peopleCommand } = await import('./cli/commands/people.js');
    await peopleCommand({ ...program.opts(), ...opts, search });
  });

program
  .command('send [text]')
  .option('--text-file <path>', 'Read the text from a file, or - for standard input')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Send a message: reply to a thread or start a new one')
  .option('--thread <id>', 'Reply to an existing thread or DM')
  .option('--to <names...>', 'Start new thread with recipient(s) by name (never posts to a DM; see `glue guide`)')
  .option('--subject <subject>', 'Subject for new thread (used with --to)')
  .option('--chat', 'Allow posting a loose message into a group\'s main chat timeline (bypasses the groupChat guard)')
  .option('--attach <files...>', 'Attach file(s) by path')
  .option('-y, --yes', 'Send without asking')
  .option('--new', 'Always send a new message (skip dedupe window)')
  .option('--update', 'Explicitly replace the most recent message to this destination (bypasses similarity gate)')
  .action(async (text, opts) => {
    const { sendCommand } = await import('./cli/commands/send.js');
    await sendCommand(text, { ...program.opts(), ...opts });
  });

program
  .command('restore <messageId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Restore a message to its prior body using the local undo log (in the settings folder, 7-day TTL)')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (messageId, opts) => {
    const { restoreCommand } = await import('./cli/commands/restore.js');
    await restoreCommand(messageId, { ...program.opts(), ...opts });
  });

program
  .command('tone')
  .description('Print your tone file, to read before drafting')
  .action(async (opts) => {
    const { toneCommand } = await import('./cli/commands/tone.js');
    await toneCommand({ ...program.opts(), ...opts });
  });

program
  .command('delete-thread <id>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .option('-y, --yes', 'Delete without asking')
  .description('Delete a thread by ID (destructive)')
  .action(async (id, opts) => {
    const { deleteThreadCommand } = await import('./cli/commands/delete-thread.js');
    await deleteThreadCommand(id, { ...program.opts(), ...opts });
  });

// Thread management
program
  .command('thread-add <threadId> <names...>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Add recipients to a thread by name or user ID')
  .action(async (threadId, names, opts) => {
    const { threadAddCommand } = await import('./cli/commands/thread-add.js');
    await threadAddCommand(threadId, names, { ...program.opts(), ...opts });
  });

program
  .command('thread-remove <threadId> <names...>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Remove recipients from a thread by name or user ID')
  .action(async (threadId, names, opts) => {
    const { threadRemoveCommand } = await import('./cli/commands/thread-remove.js');
    await threadRemoveCommand(threadId, names, { ...program.opts(), ...opts });
  });

program
  .command('thread-close <id>')
  .option('-y, --yes', 'Close without asking')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Close a thread (destructive)')
  .action(async (id, opts) => {
    const { threadCloseCommand } = await import('./cli/commands/thread-close.js');
    await threadCloseCommand(id, { ...program.opts(), ...opts });
  });

program
  .command('thread-reopen <id>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Reopen a closed thread')
  .action(async (id, opts) => {
    const { threadReopenCommand } = await import('./cli/commands/thread-reopen.js');
    await threadReopenCommand(id, { ...program.opts(), ...opts });
  });

program
  .command('thread-update <id>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Update a thread')
  .option('--subject <subject>', 'New thread subject')
  .option('--public', 'Make the thread public')
  .option('--private', 'Make the thread private')
  .action(async (id, opts) => {
    const { threadUpdateCommand } = await import('./cli/commands/thread-update.js');
    await threadUpdateCommand(id, { ...program.opts(), ...opts });
  });

// Group management
program
  .command('group-create <name>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Create a new group')
  .action(async (name, opts) => {
    const { groupCreateCommand } = await import('./cli/commands/group-create.js');
    await groupCreateCommand(name, { ...program.opts(), ...opts });
  });

program
  .command('group-delete <nameOrId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .option('-y, --yes', 'Delete without asking')
  .description('Delete a group by name or ID (destructive)')
  .action(async (nameOrId, opts) => {
    const { groupDeleteCommand } = await import('./cli/commands/group-delete.js');
    await groupDeleteCommand(nameOrId, { ...program.opts(), ...opts });
  });

program
  .command('group-update <nameOrId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Update a group')
  .option('--name <name>', 'New group name')
  .option('--public', 'Make the group public')
  .option('--private', 'Make the group private')
  .action(async (nameOrId, opts) => {
    const { groupUpdateCommand } = await import('./cli/commands/group-update.js');
    await groupUpdateCommand(nameOrId, { ...program.opts(), ...opts });
  });

program
  .command('group-members <nameOrId>')
  .description('List members of a group')
  .action(async (nameOrId, opts) => {
    const { groupMembersCommand } = await import('./cli/commands/group-members.js');
    await groupMembersCommand(nameOrId, { ...program.opts(), ...opts });
  });

program
  .command('group-add <groupNameOrId> <names...>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Add members to a group by name or user ID')
  .action(async (groupNameOrId, names, opts) => {
    const { groupAddCommand } = await import('./cli/commands/group-add.js');
    await groupAddCommand(groupNameOrId, names, { ...program.opts(), ...opts });
  });

program
  .command('group-remove <groupNameOrId> <names...>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Remove members from a group by name or user ID')
  .action(async (groupNameOrId, names, opts) => {
    const { groupRemoveCommand } = await import('./cli/commands/group-remove.js');
    await groupRemoveCommand(groupNameOrId, names, { ...program.opts(), ...opts });
  });

program
  .command('group-join <nameOrId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Join a group')
  .action(async (nameOrId, opts) => {
    const { groupJoinCommand } = await import('./cli/commands/group-join.js');
    await groupJoinCommand(nameOrId, { ...program.opts(), ...opts });
  });

program
  .command('group-leave <nameOrId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Leave a group')
  .action(async (nameOrId, opts) => {
    const { groupLeaveCommand } = await import('./cli/commands/group-leave.js');
    await groupLeaveCommand(nameOrId, { ...program.opts(), ...opts });
  });

program
  .command('guide')
  .description('Print comprehensive agent-oriented reference for the CLI')
  .action(async (opts) => {
    const { guideCommand } = await import('./cli/commands/guide.js');
    await guideCommand({ ...program.opts(), ...opts });
  });

program
  .command('draft-save [text]')
  .option('--text-file <path>', 'Read the text from a file, or - for standard input')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Save an unsent draft (new thread via --to, or update one with --id)')
  .option('--to <names...>', 'Recipients by name; pass grp_… IDs for groups')
  .option('--subject <subject>', 'Draft subject')
  .option('--reply-to <messageId>', 'Anchor the draft as a branch off a message')
  .option('--id <draftId>', 'Update an existing draft (dft_…)')
  .action(async (text, opts) => {
    const { draftSaveCommand } = await import('./cli/commands/draft.js');
    await draftSaveCommand(text, { ...program.opts(), ...opts });
  });

program
  .command('draft-send <draftId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Send a saved draft (creates the thread/message, consumes the draft)')
  .action(async (draftId, opts) => {
    const { draftSendCommand } = await import('./cli/commands/draft.js');
    await draftSendCommand(draftId, { ...program.opts(), ...opts });
  });

program
  .command('draft-delete <draftId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .option('-y, --yes', 'Delete without asking')
  .description('Delete a saved draft (destructive)')
  .action(async (draftId, opts) => {
    const { draftDeleteCommand } = await import('./cli/commands/draft.js');
    await draftDeleteCommand(draftId, { ...program.opts(), ...opts });
  });

program
  .command('mark-read <threadIds...>')
  .option('-y, --yes', 'Change several threads without asking')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Mark thread(s) read (or --unread). Accepts plain thr_… IDs.')
  .option('--unread', 'Mark unread instead of read')
  .action(async (threadIds, opts) => {
    const { markReadCommand } = await import('./cli/commands/mark-read.js');
    await markReadCommand(threadIds, { ...program.opts(), ...opts });
  });

program
  .command('download <ids...>')
  .description('Download file attachments from thread(s), message(s), or file ID(s). Accepts thr_…, msg_…, fil_… (deduped by file ID).')
  .option('--out <dir>', 'Output directory (default: current directory)')
  .action(async (ids, opts) => {
    const { downloadCommand } = await import('./cli/commands/download.js');
    await downloadCommand(ids, { ...program.opts(), ...opts });
  });

program
  .command('ai <contextThreadId> <prompt>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Ask Glue AI about a thread — starts an AI session and returns the agent\'s reply')
  .option('--wait <ms>', 'How long to wait for the reply', count, '10000')
  .option('--cancel', 'Cancel the AI session after getting the reply')
  .action(async (contextThreadId, prompt, opts) => {
    const { aiCommand } = await import('./cli/commands/ai.js');
    await aiCommand(contextThreadId, prompt, { ...program.opts(), ...opts });
  });

program
  .command('pins <threadId>')
  .description('List a thread\'s pinned resources (files, links, messages, threads)')
  .action(async (threadId, opts) => {
    const { pinsCommand } = await import('./cli/commands/pins.js');
    await pinsCommand(threadId, { ...program.opts(), ...opts });
  });

program
  .command('pin-resource <threadId> <resourceId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Pin a resource (message/file/thread ID) to a thread')
  .action(async (threadId, resourceId, opts) => {
    const { pinResourceCommand } = await import('./cli/commands/pins.js');
    await pinResourceCommand(threadId, resourceId, { ...program.opts(), ...opts });
  });

program
  .command('unpin-resource <pinnedResourceId>')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Unpin a pinned resource by its pir_ ID')
  .action(async (pinnedResourceId, opts) => {
    const { unpinResourceCommand } = await import('./cli/commands/pins.js');
    await unpinResourceCommand(pinnedResourceId, { ...program.opts(), ...opts });
  });

program
  .command('remind <threadId> [when]')
  .option('--dry-run', 'Report what would change, and change nothing')
  .description('Set a personal reminder on a thread (ISO time or 30m/2h/1d), or --clear')
  .option('--clear', 'Clear the reminder')
  .action(async (threadId, when, opts) => {
    const { remindCommand } = await import('./cli/commands/remind.js');
    await remindCommand(threadId, when, { ...program.opts(), ...opts });
  });

program
  .command('unread')
  .description('Show mailbox counts: unread inbox, mentions, unseen activity')
  .action(async (opts) => {
    const { unreadCommand } = await import('./cli/commands/unread.js');
    await unreadCommand({ ...program.opts(), ...opts });
  });

program
  .command('notifications')
  .alias('inbox')
  .description('Show the notification/activity feed (mentions, replies, approvals)')
  .option('--feed <type>', 'Feed type: all, direct, mentions', 'all')
  .action(async (opts) => {
    const { notificationsCommand } = await import('./cli/commands/notifications.js');
    await notificationsCommand({ ...program.opts(), ...opts });
  });

program
  .command('drafts')
  .description('List saved (unsent) message drafts')
  .option('--last <n>', 'Max drafts to fetch', positive, '50')
  .action(async (opts) => {
    const { draftsCommand } = await import('./cli/commands/drafts.js');
    await draftsCommand({ ...program.opts(), ...opts });
  });

program
  .command('chats')
  .description('List persistent chats — running group chats or 1:1 DMs (distinct from named threads)')
  .option('--type <type>', 'Chat type: group or user', 'group')
  .option('--last <n>', 'Max chats to fetch', positive, '30')
  .option('--order <order>', 'Sort order: unread, lastMessage, created', 'unread')
  .action(async (opts) => {
    const { chatsCommand } = await import('./cli/commands/chats.js');
    await chatsCommand({ ...program.opts(), ...opts });
  });

program
  .command('emojis')
  .description('List workspace custom emoji names (use the name as the <type> for `glue react`)')
  .option('--search <text>', 'Filter emoji names')
  .action(async (opts) => {
    const { emojisCommand } = await import('./cli/commands/emojis.js');
    await emojisCommand({ ...program.opts(), ...opts });
  });

program
  .command('watch')
  .description('Watch for real-time messages via Stream (no polling)')
  .option('--thread <id>', 'Watch a single thread')
  .option('--renames', 'Emit only subject-change (rename) events')
  .action(async (opts) => {
    const { watch } = await import('./cli/commands/watch.js');
    await watch(undefined, { ...program.opts(), ...opts });
  });

// The one place errors are printed. Refusals and failures carry a next step, so agents can correct
// themselves without guessing. exitCode, not process.exit: exit() can cut off output still buffered
// for a pipe.
program.parseAsync().catch(async (error: unknown) => {
  const { resolveFormat } = await import('./cli/output.js');
  const { InterruptedError, safeErrorMessage } = await import('./errors.js');
  // Ctrl-C at a prompt: a person is at the terminal and knows why it stopped.
  if (error instanceof InterruptedError) {
    console.error(error.message);
    process.exitCode = 130;
    return;
  }
  const message = safeErrorMessage(error instanceof Error ? error.message : String(error));
  const rawHint = (error as { hint?: unknown })?.hint;
  const hint = typeof rawHint === 'string' && rawHint ? safeErrorMessage(rawHint) : undefined;
  const stack = program.opts().verbose && error instanceof Error && error.stack ? safeErrorMessage(error.stack) : undefined;

  if (resolveFormat(program.opts()) === 'json') {
    console.error(JSON.stringify({ error: true, message, ...(hint ? { hint } : {}), ...(stack ? { stack } : {}) }));
  } else {
    console.error(`Error: ${message}`);
    if (hint) console.error(hint);
    if (stack) console.error(stack);
  }
  process.exitCode = 1;
});
