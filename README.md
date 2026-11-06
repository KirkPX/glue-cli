# Glue CLI

[![CI](https://github.com/KirkPX/glue-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/KirkPX/glue-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Command-line client for [Glue](https://glue.co) — threads, messages, groups, reactions, drafts, notifications, and a real-time event stream, over Glue's GraphQL API and its GetStream chat layer. JSON output by default, `--pretty` for humans. Built to be driven by both people and AI agents.

Runs on macOS, Windows and Linux. Output is readable at a terminal and JSON in a pipe, every
change can be previewed or blocked, and your sign-in stays in the OS keychain.

## Install

You need **Node.js 20 or newer** and Git.

```bash
cd ~
git clone https://github.com/KirkPX/glue-cli.git
cd glue-cli
npm run setup
glue login
```

`cd ~` puts the tool in your home folder. A PowerShell window can open in a system folder, where
the clone would fail or be hard to find. To update later:

```bash
cd ~/glue-cli
git pull
npm run setup
```

`npm run setup` installs, builds, links, and then tells you where you stand. If the `glue`
command is not reachable yet, it says so and prints the fix.

On Windows, install Node and Git with `winget install OpenJS.NodeJS.LTS Git.Git`, then use a **new** PowerShell
window, because an open window keeps the old PATH. You need no compiler.

## Sign in

```bash
glue login            # opens a local page in your browser, for Google sign-in
glue login --email    # Glue emails you a code to type in. No browser needed
glue login --force    # sign in again, when you already have a saved sign-in
glue login --paste    # no browser: paste a refresh token, or pipe it in
glue logout
```

Use the way you sign in to Glue itself. If Glue's app emails you a code, use `--email`. A
Google account that Glue does not know is refused, and the message points to `--email`.

With a saved sign-in, plain `glue login` only shows it. Running `glue` with no arguments signs
you in if you never have, and shows help otherwise.

Signing in needs three values that you supply: the `firebase` block in the settings file, or the
matching `GLUE_FIREBASE_` variables. They are not built in. See
[docs/configuration.md](docs/configuration.md). Reactions, quote-replies and `watch` also need
`streamKey`. `glue doctor` says whether each is set.

For CI and agents, where no keychain exists, set the token in the environment. It overrides a
saved sign-in:

```bash
export GLUE_REFRESH_TOKEN=<your-token>
```

```powershell
$env:GLUE_REFRESH_TOKEN = "<your-token>"
```

## Configure

Highest wins:

1. Command flags
2. Environment variables (`GLUE_REFRESH_TOKEN`, `GLUE_API_URL`, `GLUE_READ_ONLY`)
3. The settings file, and the keychain for tokens
4. Built-in defaults

```bash
glue config path    # where the settings file lives
glue config show    # check the file and print it
```

See [docs/configuration.md](docs/configuration.md) and [examples/config.json](examples/config.json).

## First command

```bash
glue me            # readable at a terminal
glue me --json     # JSON
glue me | cat      # JSON when piped, with no flag
```

## Output

Every command prints **readable text** at a terminal and **JSON** when the output is piped or
redirected, or when you pass `--json`. `--pretty` asks for readable text in a pipe. `glue guide`
always prints text, and `glue watch` prints one JSON object per line. A command that fails
prints the reason on stderr, with the next step in `hint`, and leaves stdout empty. A change
refused for lack of `--yes` reports that on stdout as well, and exits 1.

## Safety

Commands that change data:

- refuse to run in read-only mode (`--read-only`, `GLUE_READ_ONLY=1`, or `"readOnly": true` in the settings file)
- take `--dry-run` to report the change and make none
- ask first when they delete, close a thread, change several threads, or send text. In a script, pass `--yes`

## Long text and PowerShell

PowerShell strips double quotes inside arguments, so `send`, `edit`, `quote`, `subthread` and `draft-save` can read their text from a file, or from standard input:

```bash
glue send --text-file message.txt --thread <thr_id> --yes
```

```powershell
Get-Content message.txt | glue send --text-file - --thread <thr_id> --yes
```

## Commands

Full agent-oriented reference with flags, gotchas, and patterns: **`glue guide`**.

### Reading & search

| Command | Description |
|---------|-------------|
| `glue threads [--search] [--messages] [--group] [--author] [--all]` | Search/list threads (server-side filtering; `--all` paginates past the ~500/page cap) |
| `glue thread <id> [--limit n] [--oldest]` | View a thread's messages |
| `glue message <id>` | View one message (includes `streamID`, `quotedMessage`, attachments) |
| `glue download <ids...> [--out dir]` | Download attachments (accepts `thr_`/`msg_`/`fil_` IDs; deduped, never overwrites — see [docs/attachments.md](docs/attachments.md)) |
| `glue unread` / `glue notifications [--feed]` | Mailbox counts / activity feed (mentions, replies) |
| `glue chats [--type group\|user]` | Persistent group chats and DMs |
| `glue people <search>` / `glue groups` | Workspace member / group lookup |
| `glue emojis [--search s]` | Workspace custom emoji names (use a name with `glue react`) |
| `glue directory [--refresh]` | Browse the local people/group index (accrues as you use the CLI) |
| `glue watch [--thread id] [--renames]` | Real-time NDJSON event stream (no polling) |
| `glue thread-activity <id> [--renames]` | Thread timeline events (subject changes, branch events) |
| `glue rename-audit [--threads n]` | Sweep recent threads for rename history |

### Sending & editing

| Command | Description |
|---------|-------------|
| `glue send <text> --thread <id>` | Reply to a thread (dedupe-gated — see below) |
| `glue send <text> --to <names\|grp_ids> --subject <s>` | Start a new thread (`--to` resolves **person names**; pass group **IDs** for groups) |
| `glue send ... --attach <files...>` | Attach files (PDF, images, CSV, ZIP, …) |
| `glue edit <id> <text>` | Edit a message in place |
| `glue restore <id>` | Revert a message via the local undo log |
| `glue quote <id> <text>` | Quote-reply embedding the referenced message |
| `glue subthread <anchorId> <text>` | Start a subthread inside a thread (`thr_…`), or a branch off one message (`msg_…`) |
| `glue react <id> <type> [--remove]` | Reactions: `+1`, `heart`, `joy`, `astonished`, `pensive`, `fire`, custom emoji names |
| `glue draft-save` / `draft-send` / `draft-delete` / `glue drafts` | Saved-draft workflow |
| `glue pin`/`unpin <messageId>`, `glue pins <thr>` | Pin management |
| `glue pin-resource <thr> <msg_\|fil_\|thr_>` / `glue unpin-resource <pir_>` | Pin a file/link/message/thread to a thread (`pir_` IDs come from `glue pins`) |
| `glue remind <thr> <2h\|ISO>` | Personal reminders |
| `glue mark-read <thr...>` | Mark threads read/unread |
| `glue ai <thr> <prompt>` | Ask Glue AI about a thread |

### Management

| Command | Description |
|---------|-------------|
| `glue group-create/delete/update/members/add/remove/join/leave` | Group management |
| `glue thread-add/remove/close/reopen/update`, `glue delete-thread` | Thread management |
| `glue delete-message <id>` | Delete a message |
| `glue tone` | Print your tone file (`tone.md` in the settings folder), to read before drafting |
| `glue login [--status\|--refresh\|--force\|--email\|--paste]` / `glue logout` / `glue me` | Sign-in & identity |
| `glue doctor` | Check the install, settings file and sign-in |
| `glue config path\|show` / `glue auth` | Settings file / saved sign-in |

### Name resolution & the directory

`--to`/`--group` resolve names to IDs for you and remember what they learn in a local directory (`cache.json` in the settings folder). It fills in over time — every `glue people` search and every resolution adds to it — so `glue directory` becomes a growing map of who and what you interact with. `glue directory --refresh` pulls the full current group list; `--clear` empties it; the global `--no-cache` flag bypasses it for a single command. Because Glue's member API is search-only, people accrue as you look them up (groups can be listed in full).

### Sending a DM

`glue send --to <person>` starts a new thread. It never posts to a DM, with or without `--subject`. A DM is the persistent one-to-one chat with `threadType: userChat`, so send to its ID:

```bash
glue chats --type user --last 200          # match the exact name, take the thr_ ID
glue send "<text>" --thread <thr_…>
```

`glue chats` defaults to `--type group` and `--last 30`, so a DM is easy to miss without both flags. The CLI has no command that creates a DM.

### Starting a thread with a group ("cc a group")

`--to` resolves **person names** only. A **group name** fails with `Error: no user found matching "..."`. Pass the group **IDs** (from `glue groups`) instead:

```bash
glue send "<text>" --to grp_AAA grp_BBB --subject "Topic"   # one shared thread for both groups
```

Note the distinction: `--thread <groupChatId>` would post a loose chat message into a group's running chat — the CLI **refuses** this (exit 2) and prints the `--to <grp_…> --subject` fix, because "post in a group" almost always means a discrete, subject-titled thread. `--chat` is the explicit escape hatch.

## Send safety

`glue send` won't silently overwrite a recent message if the new body is on a different topic. Within the 5-min dedupe window it compares body similarity:

- ≥ 70% similar → auto-updates in place (revision case)
- < 70% similar → refuses with **exit code 2** and prompts for `--new`, `--update`, or `glue edit <id>`

Every in-place update saves the prior body to `undo/<msg_id>.json` in the settings folder (7-day TTL). `glue restore <msg_id>` reverts. Details: [docs/send-safety.md](docs/send-safety.md).

## Claude Code Skill (optional)

This repo ships a generic `/glue` slash command that teaches an agent to drive the CLI safely (draft→approve→send, group-thread gotchas, formatting rules):

- **Project-local (automatic):** [.claude/commands/glue.md](.claude/commands/glue.md) loads when an agent opens this repo.
- **Global:** `mkdir -p ~/.claude/commands && cp .claude/commands/glue.md ~/.claude/commands/glue.md`

Agents can also run `glue guide` in any project for the full reference.

## Documentation

| Doc | What's in it |
|-----|--------------|
| [docs/send-safety.md](docs/send-safety.md) | Dedupe window, similarity gate, exit codes, undo/restore |
| [docs/attachments.md](docs/attachments.md) | Uploading (`send --attach`) and downloading (`glue download`) — flows, ID forms, filename/collision rules, error semantics |
| [docs/thread-activity.md](docs/thread-activity.md) | How timeline/rename events work (GetStream `system` messages, not GraphQL) |
| [docs/configuration.md](docs/configuration.md) | Settings file, environment variables, where tokens are stored |
| [docs/cross-platform.md](docs/cross-platform.md) | What runs where, and the rules for keeping it so |

## Troubleshooting

```bash
glue doctor        # install, settings file, credential store, sign-in
npm run doctor     # the same check, when the command itself is not found
```

- **"Not signed in"**: run `glue login`, or set `GLUE_REFRESH_TOKEN`.
- **401 after signing in**: a `GLUE_` variable in your environment overrides the saved sign-in. `glue doctor` names it. Unset it, then run `glue login --force` if it still fails.
- **"Invalid settings"**: the settings file has a typo or an unknown key. The message names it.
- **`glue on PATH: shadowed`**: another program named `glue` comes first on your PATH.
- **"running scripts is disabled on this system"** (PowerShell): the execution policy blocks npm's `.ps1` launcher. Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Uninstall

```bash
glue logout                         # removes the saved sign-in; run this first
npm uninstall -g @kirkpx/glue-cli
```

The settings folder stays. `glue config path` shows where it is, before you uninstall.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md). `npm run dev -- <command>` runs without building.

## Library Usage

```typescript
import { GlueAPIClient, config } from '@kirkpx/glue-cli';
const client = new GlueAPIClient();
const me = await client.getMe();
```

## License

MIT. See [LICENSE](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
