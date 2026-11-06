# Glue CLI

CLI for [Glue](https://glue.co) messaging: GraphQL API plus GetStream chat layer.

**Self-describing:** run `glue guide` for the comprehensive agent-oriented reference (all commands, reaction type names, markdown rules, architecture notes). Prefer it over re-reading source.

## Quick Start

```bash
npm run setup               # Install, build, link, and check
glue login                  # Browser sign-in. `--email` for a code by email, `--paste` with a token
glue me                     # Verify
```

## Claude Code Skill

The `/glue` slash command lives at [.claude/commands/glue.md](.claude/commands/glue.md) — Claude Code auto-loads it when working in this repo. To make it globally available:

```bash
cp .claude/commands/glue.md ~/.claude/commands/glue.md
```

## Dev Mode

```bash
npm run dev -- <command>    # Run without building (uses tsx)
```

## Architecture

- `src/index.ts`: Commander entry point, lazy command imports, the one error handler.
- `src/lib.ts`: library exports (`GlueAPIClient`, `config`, types) for programmatic use.
- `src/cli/commands/`: one file per command, thin wrappers over the clients.
- `src/client.ts`: every HTTP request, with timeout, limited visible retries and safe errors.
- `src/client-graphql.ts`: GraphQL API client (threads, groups, messages, pin, delete, edit, drafts, notifications, AI sessions).
- `src/client-realtime.ts`: GetStream Chat client (reactions, quote-replies, watch, thread-activity). Reactions and quote-replies need a `streamID`, which is separate from the Glue `msg_*` ID. `GlueAPIClient.getMessage` returns both.
- `src/services/token-refresh.ts`: Firebase token renewal.
- `src/services/migrate.ts`: moves tokens from an old `config.json`, with no new sign-in.
- `src/paths.ts`, `src/settings.ts`, `src/config.ts`, `src/auth.ts`: settings folder, checked settings file, precedence, credential stores.
- `src/errors.ts`: typed errors and redaction.
- `src/cli/output.ts`, `src/cli/guardrails.ts`: the Reporter, read-only mode, dry runs, consent.
- `src/login/`: sign-in server, page, browser opener, paste prompt.
- `src/cli/commands/tone.ts`: prints `tone.md` from the settings folder. The CLI never changes a message's text.
- `src/cli/rename.ts`: parser for subject-change events. See [docs/thread-activity.md](docs/thread-activity.md).

## Library Usage

```typescript
import { GlueAPIClient, config } from '@kirkpx/glue-cli';
const client = new GlueAPIClient();
const me = await client.getMe();
```

## Auth

`glue login` serves a localhost page that calls Firebase `signInWithPopup`, using values the user supplies. None is built in, and docs must not say where they come from. It proves the token against Glue, then saves it to the keychain, or to a private file where the keychain is closed. `GLUE_REFRESH_TOKEN`, `GLUE_ACCESS_TOKEN` and `GLUE_USER_ID` override the saved sign-in.

## API

- GraphQL endpoint: `https://api.gluegroups.com/graphql` (override: `GLUE_API_URL`).
- Real-time layer: GetStream Chat (`chat.stream-io-api.com`). Its token comes from the Glue API.

## Conventions

- Commands print JSON when piped and readable text at a terminal. Errors go to stderr, with an optional `hint`. Read it before diagnosing.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md). Verify with `npm run typecheck && npm test`.
- Use server-side filtering (`ThreadsFilter.matchMessages`, `recipientId`, `match`) over client-side
- No hardcoded IDs — resolve names to IDs via API
- `send --to` resolves **person names only**. A group *name* fails with `no user found`; pass the group **ID** (`grp_…`) instead — IDs short-circuit resolution. To start a thread shared with groups: `glue send "<text>" --to grp_AAA grp_BBB --subject "<subj>"`.
- `send --to <person>` never posts to a DM. It starts a `thread`. A DM is a `userChat`: find its ID with `glue chats --type user --last 200`, then use `send --thread <thr_…>`. The CLI has no command that creates a DM.
- **Posting "in a group" means a discrete THREAD, never a loose chat message.** A group link (`thr_…`) is the group's running chat (`threadType: "groupChat"`), not a thread. `send` **refuses** `--thread <groupChatId>` (exit 2) and prints the exact `--to <grp_…> --subject` fix. `--chat` is the only escape hatch for a deliberate loose message. Guard lives in `send.ts`, mirroring the `groupChat` check in `thread-remove.ts`.
- Send safety (dedupe window, similarity gate, undo log): [docs/send-safety.md](docs/send-safety.md)
- No live mutations without user approval; probe in a dedicated test group (`glue group-create __cli-test`)
