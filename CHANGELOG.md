# Changelog

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
