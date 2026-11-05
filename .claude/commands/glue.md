---
description: Route Glue messaging tasks — send, reply, search, read threads, manage groups, reactions, quotes, edits
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent]
---

# Glue Messaging

**Purpose:** Route Glue CLI operations when a user wants to interact with Glue from any project.

## Self-Describing Reference

Before hand-rolling anything, run:

```bash
glue guide
```

This prints the canonical agent-oriented reference — every command, every reaction type, markdown formatting rules, and the GraphQL/GetStream architecture notes. If a question isn't answered here, run `glue guide`.

## Usage Shorthand

```
/glue msg <person> <message>       # New message (new thread) to someone
/glue thread <thread_id> <message> # Reply to an existing thread
/glue read <thread>                # Read a thread
/glue search <query>               # Search threads/messages
/glue threads                      # List recent threads
/glue groups                       # List groups
/glue people <name>                # Look up a person
/glue react <msg> <type>           # Add reaction (+1, heart, joy, astonished, pensive, fire)
/glue quote <msg> <text>           # Quote-reply
/glue edit <msg> <text>            # Edit an existing message
/glue <anything else>              # Route to the right glue subcommand
```

### Routing Keywords: `msg` vs `thread`

- **`msg`** — Start a **new thread** to a person or group. Uses `--to`. This never posts to a DM.
- **`thread`** — **Reply** to an existing thread or DM. Uses `--thread`.

If neither is present, infer from context:
- Thread ID mentioned or conversation about an existing thread → `thread` (reply)
- Person's name with no thread context → `msg` (new thread)

## Core Workflow: Drafting Messages

Every time a user asks to send, reply, edit, or quote:

1. **Draft first** — compose the message in the user's tone. Run `glue tone` first, and follow what it prints. The CLI applies nothing from it, and never changes a message.
2. **Show the draft** — present it for review before sending.
3. **Revise on feedback** — any follow-up about the draft is a revision, not a new task. Keep revising the same draft until approved.
4. **Send on approval** with `--yes`:

```bash
glue send "<text>" --to "<name>" --subject "<subject>" --yes      # New thread to a PERSON
glue send "<text>" --to grp_AAA grp_BBB --subject "<subject>" --yes # New thread shared with GROUP(s) — use group IDs
glue send "<text>" --thread <thread_id> --yes                     # Reply
glue edit <messageId> "<text>" --yes                              # Edit
glue quote <messageId> "<text>" --yes                             # Quote-reply
```

Without `--yes`, the CLI prints a confirmation prompt to stderr — agents should use `--yes` after getting approval in-conversation. **This applies to `glue edit` too**: it triggers the same tone-confirmation prompt, and without `--yes` the command hangs waiting for input (silently, if backgrounded).

For long messages, write to a temp file first and pass `"$(cat /tmp/glue-msg.txt)"` — avoids shell-quoting bugs.

### Sending a series of messages — `--new` vs `--update`

`glue send` has a ~5-minute dedupe window: a second send to the same destination may be treated as a *correction* and update the prior message in place (or refuse with exit 2 if the topics look different). Never rely on the default when sending more than one message in quick succession — disambiguate explicitly:

| Flag | Use when |
|---|---|
| `--new` | Posting a **distinct message** (follow-up, different topic, a series of posts). Forces a fresh message. |
| `--update` | Explicitly **correcting** your most recent message to this destination. Replaces in place. |
| (neither) | Only for a single send with no follow-up planned within ~5 min. |

### Fixing a just-sent message — always `glue edit`

Capture `.message.id` from every `glue send` JSON response. To correct, reformat, or revise a sent message, run `glue edit <id> "<text>" --yes` — deterministic, works regardless of elapsed time. Never re-send and hope the dedupe window catches it. Every in-place update is undoable via `glue restore <id>` (7-day local undo log).

### @-Mentions

Format: `[Display Name](glue:<userID>)` — same syntax received messages use; works on send and edit. Resolve the ID with `glue people "<name>"` (`.people[0].id`). Plain-text names do **not** notify anyone — only the mention syntax does. If a message has a single natural action-taker in a multi-recipient thread, @ them at the top; a missing @ on an actionable message is a dropped task.

### Check before you send (no-spam)

Before replying to a thread, read its recent messages (`glue thread <id> --limit 10`). Don't post if the same information is already there from you — offer to update the existing message instead. And read the last few messages anyway: know what's been said, who's on the thread, and match the conversation's tone. Remember every send goes out under the **user's own account** — prior messages from them in the thread are their prior actions, not discoveries to narrate back.

### Threads to groups, and "thread vs. message" (common gotcha)

- `--to` resolves **person names only**. A group *name* (`--to "Sales"`) fails with `Error: no user found matching "..."`. To address a thread to one or more **groups**, pass the group **IDs** (`grp_…`, from `glue groups`) — IDs bypass name resolution. Multiple recipients (people and/or group IDs) make **one shared named thread**, which is how you "cc" a group.
- To set a **named thread's** subject (`threadType: "thread"`), use `--to … --subject …`. Without `--subject`, `--to` still starts a `thread`, and Glue writes the subject. Replying with `--thread <groupChatId>` posts a **chat message** into the group's running chat — not a thread. So when the user asks for "a thread, not a message" or to "cc a group", build it with `--to <groupIds> --subject`, never `--thread` into the group chat.

### Picking the right message shape

Glue has three thread types plus two kinds of thread-in-a-thread (subthread and branch) — pick deliberately:

| Shape | What it is | Use for |
|-------|-----------|---------|
| `userChat` | Persistent DM with one person | Quick questions, casual follow-ups — the default for one person |
| `groupChat` | A group's running chat | **One-line, ephemeral** notes to a group ("deploy's done") |
| `thread` | Named thread with a subject | Formal topics, multi-person discussions, anything needing its own context |
| subthread | A `thread` inside another thread, with no anchor message (`glue subthread <thr_…>` — the web composer's "Thread" button) | A **side topic that belongs to an existing thread** — linked to it as its parent, with the parent's recipients |
| branch | A `thread` started off one message (`glue subthread <msg_…>` — Glue's "reply in thread"). "A subthread off this message" means this | A **structured ask raised inside a group chat** — stays in the channel but gets its own followable home |

To send to a `userChat`: run `glue chats --type user --last 200`, match the exact name, then `glue send "<text>" --thread <thr_…>`. `glue thread <thr_…> --limit 1 --pretty` must show `Type: userChat`. `--to` never posts to a DM, and the CLI has no command that creates one. If the person is not in the list, stop and tell the user.

Escalation order: one person casual → their `userChat`; one person formal → new thread (`--to`+`--subject`); multiple people → one shared thread; group + ephemeral → flat `groupChat` reply; **group + structured/actionable → branch or named thread, never a flat reply that scrolls away**. When the user names multiple people, default to ONE shared thread — splitting later is easy, merging is impossible.

### Finding a specific message — search is recency-ranked, not relevance-ranked

- `glue threads --messages "<text>"` returns ~20 threads in rough recency order; the best content match is often near the **bottom**. Never truncate the result list when hunting — scan all of it.
- Search with the most **distinctive token** (an identifier, exact figure, unusual word), not a natural-language phrase — common words drown the hit.
- The data is often in an **attachment**, not the body: `glue message <id> --pretty` lists attachments with download URLs. Check them.
- Subject ≠ topic — a relevant message can sit in any thread; trust content search over subject lines.
- Glue deep-link URLs (`https://app.glue.ai/<threadId>/<deepLinkId>`): pass the deep-link segment straight to `glue message <id>` — it resolves as-is.

## Directory — who/what the CLI already knows

The CLI keeps a local index of people and groups (name → ID + context) that **fills in automatically as you use it**: every `glue people <search>` and every `--to`/`--group` name resolution records what it learned, and `glue groups` records them all.

- **Check it first** when a request names a person or group: `glue directory --pretty` (or JSON for parsing). If the name's already there, you have the ID without a lookup.
- **`glue directory --refresh`** pulls the full current group list from the server — do this when you need every group, not just the ones seen so far. (People can't be bulk-listed — the API only searches — so the people side grows only as you look people up.)
- This is **mechanical** knowledge only (name → ID). **Meaning** — who owns what, which group a kind of request routes to, someone's role — is not something the CLI can learn. Record that in your own memory/notes, not here.

## Attachments

```bash
glue send "<text>" --thread <id> --attach ./report.pdf
glue send "<text>" --to "<name>" --attach ./shot1.png ./shot2.png ./notes.txt
```

`--attach` accepts one or more local file paths. Supported types include PDFs,
images (PNG/JPG/GIF/WebP), text, CSV, JSON, DOC/DOCX, XLS/XLSX, ZIP. There is
**no server-side restriction by file type** — the upload backend (Box) accepts
all of these.

If an upload errors, it is a CLI bug, not a Glue/Box limitation. Past
misdiagnosis: when PDFs failed with 415, an agent assumed the server only
accepted images and proposed image-only / email-instead workarounds. The real
cause was binary-FormData mishandling in the CLI's HTTP layer. Always read the
`hint` field in stderr JSON, report the error verbatim to the user, and let
them fix the CLI before pivoting to workarounds.

## Formatting

Glue renders full markdown. Always use it for structure:

- `**bold**`, `*italic*`, `` `inline code` ``
- `- item` or `* item` bullets (blank line before the list)
- `1. item` numbered lists
- `## Heading`, `> blockquote`, fenced code blocks, `[text](url)` links
- **Never use `•`, `●`, or other Unicode bullet chars** — they render as literal text.
- **Blank line between every bullet / numbered item / logical block.** Adjacent lines separated by a single `\n` can merge into one running paragraph in Glue's renderer — the most common formatting mistake. Before sending a draft: if `bullets − 1 ≠ blank lines between them`, fix it.

**Reply style:** new threads may open with a greeting and set context; **inline replies** (`--thread`) should be short and direct — no greeting, no sign-off, no email voice. When reporting status/numbers, lead with the data, skip the preamble.

## Reactions

Glue's internal reaction type strings:

- `+1` (thumbs up), `heart`, `joy` (😂), `astonished` (wow), `pensive` (sad), `fire`
- Shortcuts Glue maps: `like→+1`, `love→heart`, `haha→joy`, `wow→astonished`, `sad→pensive`

```bash
glue react <messageId> +1
glue react <messageId> heart --remove
```

## Reading & Searching

```bash
glue thread <id> --pretty                     # Full thread with messages
glue threads --pretty                         # Recent threads
glue threads --group "<name>" --pretty        # Threads in a group
glue threads --search "<subject>" --pretty    # Subject search
glue threads --messages "<content>" --author "<name>"
glue message <id> --pretty                    # Single message
glue download <id> --out ./dir                # Download attachments (thr_/msg_/fil_ ID)
glue people "<name>" --pretty                 # Workspace member lookup
glue groups --pretty                          # List groups
glue directory --pretty                       # Local people/group index (see below)
glue unread --pretty                          # Mailbox counts
glue notifications --pretty                   # Activity feed (mentions, replies)
glue watch [--thread <id>] [--renames]        # Real-time NDJSON event stream
glue thread-activity <id> [--renames]         # Timeline events (renames, branch events)
```

For JSON parsing (piping to scripts), omit `--pretty`. For human display, include it.

## Management Commands

```bash
glue group-create "<name>"
glue group-add "<group>" "<name>"
glue group-remove "<group>" "<name>"
glue group-members "<group>" --pretty
glue thread-add <id> "<name>"
glue thread-close <id>
glue thread-update <id> --subject "<new>"
glue delete-message <id> --yes
glue pin <messageId> / glue unpin <messageId>
```

## Safety Rules

- **Never mutate real Glue data without explicit user approval.**
- For testing/exploration, use a dedicated test group (create one with `glue group-create __test` if needed).
- Never add real people to test threads.
- Always draft → get approval → send with `--yes` in a non-interactive agent context.

## Routing

If the user's request doesn't match a pattern above, run `glue --help` or `glue <command> --help` for options, or `glue guide` for the full reference.
