const GUIDE = `# Glue CLI — Agent Reference

Comprehensive reference for agents driving the Glue CLI. Run \`glue guide\` to print this at any time.

## Philosophy

- JSON when piped, readable text at a terminal. \`--json\` forces JSON. Errors go to stderr.
- Draft message, get user approval, then send with \`--yes\`.
- Resolve names to IDs via API (\`glue people\`, \`glue groups\`) — never hardcode. Resolved IDs accrue in a local directory (\`glue directory\`); \`--to\`/\`--group\` check it first automatically.

## Authentication

\`\`\`
glue login            # Sign in, or show the sign-in when you already have one
glue login --force    # Sign in again
glue login --paste    # Sign in without a browser: paste the token, or pipe it in
glue login --status   # Show current token state
glue login --refresh  # Force token refresh
glue logout           # Clear the saved sign-in
glue doctor           # Check the install, settings and sign-in
glue me               # Current user

A \`GLUE_\` sign-in variable in the environment beats the saved sign-in. If \`glue\` answers 401, check for one first.
\`\`\`

## Messaging

\`\`\`
glue send "<text>" --to "<name>"            # Start a new thread, NOT a DM (PERSON name; Glue writes the subject). See "Sending a DM"
glue send "<text>" --to "<name>" --subject "<subj>"
glue send "<text>" --to grp_AAA grp_BBB --subject "<subj>"   # New thread shared with one or more GROUPS (use group IDs)
# ^ DEFAULT for "post in <group>": always start a discrete, subject-titled THREAD via --to <grp_…> --subject.
#   A pasted group link is the group's running CHAT (threadType: groupChat), NOT a thread — --thread into it
#   posts a loose message that scatters in the feed. send REFUSES that and tells you the --to/--subject fix.
glue send "<text>" --thread <id>            # Reply to existing thread or DM (a real thr_, not a group chat)
glue send "<text>" --thread <id> --attach file.pdf --attach img.png

# Attachments support all common file types — PDFs, images, text, CSV, JSON,
# DOC/DOCX, XLS/XLSX, ZIP. If an upload fails, it is a CLI bug, not a server
# restriction; check the JSON \`hint\` field and report verbatim to the user
# before suggesting any workaround.
glue send ... --yes                          # Send without asking
glue send ... --new                          # Skip 5-min dedupe window (force new message)
glue send ... --update                       # Explicitly replace the most recent message (bypass similarity gate)

glue edit <messageId> "<text>" --yes        # Edit existing message (GraphQL UpdateMessage)
glue restore <messageId>                     # Revert a message to its prior body (uses local undo log)
glue delete-message <messageId> --yes

glue quote <messageId> "<text>" --yes       # Inline-quote reply (Stream channel)
glue subthread <thr_…> "<text>" --yes       # Start a subthread inside a thread
glue subthread <msg_…> "<text>" --yes       # Start a branch off one message
glue react <messageId> <type>                # Add reaction
glue react <messageId> <type> --remove       # Remove reaction

glue pin <messageId>
glue unpin <messageId>

glue draft-save "<text>" --to "<name>" --subject "<s>"   # Save an unsent draft
glue draft-save "<text>" --id <dft_…>        # Update an existing draft
glue draft-send <dft_…>                       # Send a saved draft (consumes it)
glue draft-delete <dft_…> --yes
glue mark-read <thr_…> [thr_……]              # Mark thread(s) read; --unread to reverse
glue pins <thr_…>                             # List a thread's pinned resources
glue pin-resource <thr_…> <msg_/fil_/thr_>   # Pin a resource to a thread
glue unpin-resource <pir_…>                   # Unpin (pir_ id from \`glue pins\`)
glue remind <thr_…> 2h                        # Personal reminder (ISO time or 30m/2h/1d); --clear to remove
glue ai <thr_…> "<prompt>"                    # Ask Glue AI about a thread; reply comes back in a session thread
\`\`\`

**Glue AI:** \`glue ai <contextThreadId> "<prompt>"\` starts an AI session anchored to that thread and returns the agent's reply (in a new \`sessionThread\`). Continue the conversation with \`glue send "<follow-up>" --thread <sessionThreadId>\` and read it with \`glue thread <sessionThreadId>\`.

**Sending a DM:** a DM is the persistent one-to-one chat with \`threadType: userChat\`. Its subject is the person's name. \`glue send --to <person>\` never posts to a DM. With \`--subject\` it starts a named thread (\`threadType: thread\`). Without \`--subject\` it still starts a \`thread\`, and Glue writes a subject for it.

1. Find the DM: \`glue chats --type user --last 200\`. Match the exact name and take the \`thr_\` ID. Both flags matter: \`glue chats\` defaults to \`--type group\` and \`--last 30\`, so a DM is easy to miss without them.
2. Send to that ID: \`glue send "<text>" --thread <thr_…>\`.
3. Check it: \`glue thread <thr_…> --limit 1 --pretty\` must show \`Type: userChat\`.

If the person is not in the list, stop and tell the user. The CLI has no command that creates a DM. Do not use \`--to\` to make one, because the person then gets a thread instead of a DM. When a test account had no DM, Glue showed an empty \`userChat\` only after a named thread was sent to it. No other way to create a DM has been tested.

**Addressing a new thread — people vs. groups (\`--to\`):**

- \`--to\` resolves **person names** only. Passing a **group name** (e.g. \`--to "Sales"\`) fails with \`Error: no user found matching "..."\`. This is the #1 gotcha.
- To start a thread shared with one or more **groups**, pass the group **IDs** (\`grp_…\`), which bypass name resolution: \`glue send "<text>" --to grp_AAA grp_BBB --subject "<subj>"\`. Get IDs from \`glue groups\`.
- Multiple \`--to\` recipients (people and/or group IDs) create **one shared named thread** (\`threadType: "thread"\`) — that's how you "cc" a group.
- **Thread vs. chat message (ENFORCED):** \`--thread <groupChatId>\` would post a loose chat message into a group's running **groupChat** — it does NOT create a named thread. \`send\` now **refuses** this: if \`--thread\` points at a \`groupChat\`, it exits non-zero and prints the exact \`--to <grp_…> --subject …\` command to run instead (the group ID is recovered automatically). A distinct, subject-titled thread is only ever created via \`--to … --subject …\`. **Default to that for any "post in <group>" request.** The only escape hatch is \`--chat\`, for the rare case you genuinely want a loose message in the running chat.

## Reading

\`\`\`
glue thread <id> --pretty                    # Full thread with messages
glue threads --pretty                        # Recent threads
glue threads --group "<name>" --pretty       # Threads in a group
glue threads --search "<subject>" --pretty   # Subject search
glue threads --messages "<content>"          # Message-content search
glue threads --author "<name>"               # Filter matched messages by author
glue threads --last 20 --order lastMessage
glue threads --all                           # Paginate through ALL threads (past the ~500/page cap)
glue message <id> --pretty                   # Single message by ID
glue thread <id> --oldest                    # Fetch from the START of a thread (default: newest)
glue download <id> --out ./dir               # Download attachments (accepts thr_/msg_/fil_ IDs)

glue watch                                   # NDJSON stream of new/edited/deleted messages
glue watch --thread <id>                     # Watch one thread
glue watch --renames                         # Only subject-change (rename) events

glue thread-activity <id> --pretty           # Timeline events (subject changes, branch events)
glue thread-activity <id> --renames          # Only subject-change events
glue rename-audit --threads 50               # Sweep recent threads for rename history

glue unread --pretty                         # Mailbox counts: unread inbox, mentions, unseen activity
glue notifications --pretty                  # Activity feed (mentions, replies, approvals); alias: glue inbox
glue notifications --feed mentions           # Feed types: all (default), direct, mentions
glue drafts --pretty                         # Saved (unsent) drafts
glue chats --pretty                          # Persistent chats: running group chats (--type group, the default) or DMs (--type user). Shows 30 unless you pass --last
glue emojis --search ty                      # Workspace custom emoji names (use the name with \`glue react\`)
\`\`\`

**Threads within threads:** Glue has two kinds. Both are real \`thr_\` threads, and both carry \`Thread.parentThread\` (the thread they sit inside). One command makes both; the ID you pass picks the kind.

*Subthread* — a thread inside a thread (the web composer's "Thread" button): \`glue subthread <thr_…> "<text>" [--subject "…"]\`. The new thread has \`parentThread\` set and no anchor message. Under the hood it is \`sendDraft\` with the parent thread itself listed as a recipient, plus the parent's recipients.

*Branch* — a thread started off one message ("reply in thread"). When someone asks for a subthread *off a message*, this is the kind they mean. It is linked both ways:
- \`Thread.replyToMessage\` — the child thread's anchor message (and its \`threadID\` = the parent thread). \`glue thread <child> --pretty\` prints a \`Branch off …\` header; JSON includes \`replyToMessage\`.
- \`Message.replyThreadID\` — set on the anchor message, pointing to the child thread. \`glue thread\` marks such messages with \`⤷ has branch: thr_…\`; \`glue message <id>\` returns \`replyThreadID\`.
- Create one with \`glue subthread <msg_…> "<text>"\` (inherits the parent thread's recipients unless \`--to\` is given). It is NOT a GetStream reply — Glue has GetStream threading disabled; this is a first-class Glue thread created via \`sendMessage(thread: { replyToMessageID })\`.
- Posting more into a subthread or a branch is just \`glue send --thread <thr_…>\` — each is an ordinary thread.

**Quote-replies:** \`glue thread\`, \`glue message\`, and \`glue watch\` all surface a \`quotedMessage\` (or \`quoted_message\` in watch NDJSON) when one message replies to another. Always check it before interpreting an ambiguous "she/he/it/that" — the pointer tells you which prior message the speaker is responding to. Pretty output prefixes the line with \`↪ replying to <user>: "<preview>" (msg_XXX)\`.

## People & Groups

\`\`\`
glue people "<name>" --pretty                # Search workspace members
glue groups --pretty                         # List all groups
glue directory --pretty                      # Browse the local people/group index (accrues as you use the CLI)
glue directory --refresh                     # Pull the full current group list into the index
glue group-create "<name>"
glue group-delete "<nameOrId>" --yes
glue group-update "<nameOrId>" --name "new-name" --public
glue group-members "<nameOrId>" --pretty
glue group-add "<group>" "<name>" [names...]
glue group-remove "<group>" "<name>"
glue group-join "<nameOrId>"
glue group-leave "<nameOrId>"
\`\`\`

## Thread Management

\`\`\`
glue thread-add <id> "<name>" [names...]     # Add recipients
glue thread-remove <id> "<name>"
glue thread-close <id> --yes
glue thread-reopen <id>
glue thread-update <id> --subject "<subj>" [--public|--private]
glue delete-thread <id> --yes                 # Deletes the thread. Needs --yes in a script
\`\`\`

## Tone

\`glue tone\` prints your tone file, \`tone.md\` in the settings folder (\`glue config path\`). It is plain writing for whoever drafts the message. **Read it before you draft.**

The CLI applies nothing from it, and never changes a message. What you send is what goes out, so the draft has to be right.
## Formatting

**Glue renders full markdown.** Use it.

- \`**bold**\`, \`*italic*\`, \`\\\`inline code\\\`\`
- \`- item\` or \`* item\` for bullets (blank line before the list)
- \`1. item\` for numbered lists
- \`## Heading\`, \`> blockquote\`
- Triple-backtick fenced code blocks
- \`[text](url)\` for links

**Never use Unicode bullet chars** (\`•\`, \`●\`). They render as literal text.

## Reaction Types

Glue's internal reaction type strings (pass as the \`<type>\` arg to \`glue react\`):

- \`+1\` — thumbs up
- \`heart\` — red heart
- \`joy\` — 😂 laughing
- \`astonished\` — 😮 wow
- \`pensive\` — 😔 sad
- \`fire\` — 🔥
- Any registered custom emoji name — pass its literal name

Mapping shortcuts used by Glue (convert these → canonical):
\`like → +1\`, \`love → heart\`, \`haha → joy\`, \`wow → astonished\`, \`sad → pensive\`.

## Architecture Note (for debugging)

Glue uses **two backends**:

1. **GraphQL API** (\`https://api.gluegroups.com/graphql\`) — thread/group/message CRUD, auth. Used for send, edit, delete, pin, thread/group management.
2. **GetStream Chat** (real-time) — reactions, quote-replies, live events. Message IDs in Stream are NOT the same as Glue IDs — look up \`streamID\` from a Glue message (\`glue message <id>\` returns it) when calling Stream directly.

The CLI hides this split: \`react\` and \`quote\` auto-fetch the streamID, connect to Stream, perform the action, and disconnect.

## Safety

- No live mutations without explicit user approval. Use a dedicated test group for probing (create one with \`glue group-create __cli-test\`).
- Never add real people to test threads.
- See **Sending safely** below for the full dedupe / similarity-gate / undo model.

## Sending safely

\`glue send\` has a 5-min dedupe window. The decision tree:

1. **\`--new\` is passed** → always post a fresh message.
2. **No prior send within 5 min to the same thread/recipients** → post fresh.
3. **Prior send exists + new body ≥ 70% similar to the prior body** → auto-update in place (the revision case: typo fixes, tone tweaks, small rewrites).
4. **Prior send exists + new body < 70% similar** → **refuse with exit code 2**. The CLI prints the prior message preview, the new preview, the similarity %, and the three ways to disambiguate:
   - \`--new\` to post as a separate message
   - \`--update\` to explicitly replace the previous one
   - \`glue edit <id> "<text>"\` to replace a specific message by ID

The refusal is pre-action — nothing is sent or overwritten. The "Reflect:" line in the refusal output is deliberate: if you're a calling agent, stop and decide which branch matches your intent before re-running.

**Exit codes:**
- \`0\` — success
- \`1\` — generic error (missing flag, missing file, missing undo entry, etc.)
- \`2\` — ambiguous send refused; re-run with \`--new\`, \`--update\`, or \`glue edit\`

**Undo:** every in-place update (auto-dedupe path or explicit \`glue edit\`) writes the prior body to \`undo/<msg_id>.json in the settings folder\` before overwriting. Files auto-prune after 7 days. To revert: \`glue restore <msg_id>\`. After a successful restore, the undo entry is deleted (one-way revert).

## Output format

- Default: JSON to stdout (pipe-friendly). Errors always to stderr.
- \`--read-only\` (or \`GLUE_READ_ONLY=1\`, or \`readOnly\` in the settings file) refuses every change.
- \`--dry-run\` on every command that changes data reports the change and makes none.
- \`--text-file <path>\` (or \`-\` for standard input) gives \`send\`, \`edit\`, \`quote\`, \`subthread\` and \`draft-save\` their text.
- \`watch\` emits NDJSON (one JSON per line) by default; \`--pretty\` for human lines.

## Errors

Errors always go to stderr as JSON:

\`\`\`
{"error": true, "message": "...", "hint": "..."}  # hint optional
\`\`\`

When a \`hint\` field is present, **read it before drawing conclusions**. Hints
exist precisely because past agents have misdiagnosed CLI bugs as Glue API
limitations and proposed bad workarounds. If a hint says "this is a CLI bug,
not a server restriction" — that is authoritative. Report the error verbatim
to the user so they can fix the CLI; do not propose alternative workflows.

## Common patterns

### Find a thread by subject, then reply
\`\`\`
glue threads --search "P6" --pretty
glue send "reply text" --thread thr_XXX --yes
\`\`\`

### React to the latest message in a thread
\`\`\`
MSG=$(glue thread thr_XXX | jq -r '.messages[-1].id')
glue react "$MSG" +1
\`\`\`

### Edit the message you just sent
\`\`\`
OUT=$(glue send "first draft" --thread thr_XXX --yes)
MSG=$(echo "$OUT" | jq -r '.message.id')
glue edit "$MSG" "revised text" --yes
\`\`\`

### Quote-reply to a specific message
\`\`\`
glue quote msg_XXX "responding to your point about…" --yes
\`\`\`

---

For per-command flag detail: \`glue <command> --help\`.
For the Claude Code workflow skill shipped with this repo: \`/glue\`.
`;

export async function guideCommand(_opts: unknown) {
  process.stdout.write(GUIDE);
}
