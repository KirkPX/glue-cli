# Changelog

## 2.2.0

### Changes that can break a script

- You need **Node.js 22.18, 24.11 or newer**. On an older Node, or on 23 or 25, `npm run setup`
  stops with npm's own message before it builds anything, and `glue doctor` marks Node.js as failed.
- `chats --type` takes only `group` or `user`, and `--order` on `threads` and `chats` takes only
  `lastMessage`, `created` or `unread`. Before, an unknown type was read as `group`.
- `glue remind` refuses a time it cannot read, and a time in the past. Before, `1` meant the
  year 2001.

### New

- `glue config set <name> <value>` and `glue config unset <name>` change one setting, so nobody
  places a settings file by hand. Dotted names reach inside `firebase`. Token names are refused.

### Fixes

- `chats --last 3` prints 3 chats. Glue answers with one more than asked, and the CLI printed it.
- A refusal from Glue shows every reason Glue gave, and the next step for its status: 401, 403,
  404, 400 or 422, 429 and 5xx. GraphQL refusals, which arrive with HTTP 200, get the same steps.
- A mistyped command line fails with the same JSON error as every other failure when the output
  is JSON. An unknown command is named, instead of "too many arguments".
- A save or delete never writes over a damaged credentials file. It stops and says what to do.
  The one-time token move from an old `config.json` stops too, and keeps the token.
- File errors read as plain words, including the one Windows gives when a file is in the way
  of a folder.
- An edit stops when it cannot save the current text for `glue restore` first.

### Dependencies

- New major versions: commander 15, @napi-rs/keyring 2, TypeScript 7, tsup 9, vitest 5, vite 8.
- Updated: @apollo/client 4.3, graphql 16.14, stream-chat 9.54, tsx 4.23.
- CI tests Node 22, 24 and 26 on macOS, Linux and Windows.

## 2.1.0

- `glue login --email` signs in with a code that Glue emails, the way Glue's app offers
  "sign in with email". It needs no browser, so it also works over SSH.
- A Google sign-in that Glue does not know is refused with the reason, and points to
  `--email`. It used to show only "401 Unauthorized".
- A saved token with no user ID no longer blocks plain `glue login`. It signs in again.

## 2.0.0

### Changes that can break a script

- `delete-message`, `delete-thread`, `group-delete` and `draft-delete` ask first at a
  terminal, and need `--yes` in a script.
- `thread-close`, and `mark-read` with more than one thread, ask first at a terminal and need
  `--yes` in a script.
- Number options such as `--limit` refuse anything that is not a whole number.
- `send`, `edit`, `quote` and `subthread` with no `--yes` and no terminal now fail and
  say so. They used to end with nothing sent and exit 0.
- Output is readable text at a terminal, and JSON when piped. `--pretty` still works.
- Sign-in values are no longer built in. Set `firebase` in the settings file, or the
  `GLUE_FIREBASE_` variables. With none set, sign-in and token renewal fail and say so.
- The chat service's key is no longer built in. Set `streamKey` or `GLUE_STREAM_KEY`. Without
  it, `react`, `quote`, `watch`, `thread-activity` and `rename-audit` fail and say so.
- The library no longer exports `STREAM_API_KEY`.
- The CLI no longer changes message text. `tone.json` is not read, and word swaps and
  punctuation fixes are gone. `glue tone` prints `tone.md` from the settings folder, for
  whoever drafts the message.
- `glue login --token` is refused. Use `glue login --paste`, or `GLUE_REFRESH_TOKEN`.
- `glue login --status` and `--refresh` print JSON when piped.
- Argument errors are JSON on stderr when piped.
- A settings file with an unknown key stops the command.
- The library is ESM only, and needs Node 20 or later.

### New

- `--read-only`, `GLUE_READ_ONLY` and `readOnly` in the settings file stop every change.
- `--dry-run` on every command that changes data.
- `--text-file` on commands that take message text, with `-` for standard input.
- Ctrl-C at a prompt exits 130 and restores typing.
- `glue doctor`, `glue config path`, `glue config show`, `glue logout`, `glue auth`, and
  `glue login --paste`.
- Every connection has a timeout, and reads retry up to three times with a notice on stderr.

### Fixed

- `glue edit`, `glue restore` and an update from `glue send` keep the message's files.
- `threads --last` works with `--group`. `threads --last` and `thread --limit` hold to
  the count. `--group` takes a group ID.
- A first sign-in on a new machine saves the user ID.
- A thread that does not exist gets a plain message. `thread`, `message` and
  `send --thread` take a pasted link.

### Moved

- Sign-in tokens move from `config.json` to the keychain on first run, with no new sign-in.
