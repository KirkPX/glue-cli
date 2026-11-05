# Configuration

Most people need no configuration: `glue login` saves your sign-in. The settings file
is for behaviour you want every time.

## Where it lives

Run `glue config path` to see it.

| Platform | Location |
|---|---|
| macOS, Linux | `$XDG_CONFIG_HOME/glue/config.json`, or `~/.config/glue/config.json` |
| Windows | `%APPDATA%\glue\config.json` |

`GLUE_CLI_CONFIG_FILE` points the CLI at another file.

The same folder holds `tone.md` (your tone file, which `glue tone` prints), `cache.json` (people and groups
you have looked up), `last-sent.json` and `undo/` (see [send-safety.md](send-safety.md)).

## Precedence

Highest first: command flags, environment variables, the settings file (and the
keychain for tokens), defaults.

## Settings

See [examples/config.json](../examples/config.json) for a full file.

| Key | Type | Default | What it does |
|---|---|---|---|
| `baseUrl` | URL | `https://api.gluegroups.com/graphql` | The API to call. |
| `userId` | string | set by `glue login` | Your Glue user ID. |
| `readOnly` | boolean | `false` | Refuse every command that changes data. |
| `timeoutMs` | integer, up to 600000 | `30000` | How long to wait for each request. |
| `streamKey` | string | none | The chat service's key. `react`, `quote`, `watch`, `thread-activity` and `rename-audit` need it. |
| `firebase` | object | none | `webKey`, `authDomain`, `projectId`. Sign-in and token renewal need these. |

The file never holds a token.

## Sign-in settings

`glue login` and token renewal need the three `firebase` values. The CLI has no built-in values, so
you supply them, in the settings file or as `GLUE_FIREBASE_API_KEY`, `GLUE_FIREBASE_AUTH_DOMAIN` and
`GLUE_FIREBASE_PROJECT_ID`. A sign-in from an earlier version keeps any values it had saved.

## Chat setting

Reactions, quote-replies, `watch`, `thread-activity` and `rename-audit` go through the chat service,
and need its key. The CLI has none built in, so you supply it, as `streamKey` in the settings file or
as `GLUE_STREAM_KEY`. Without it, those commands fail and say so. Other commands still work.

## Validation

`glue config show` checks the file and prints it. Every command that reads the file
checks it first, and stops with the reason if it is wrong. It stops on an unknown key
too: if `readonly` were ignored as a typo, commands would write when you meant to
block them. `glue doctor` reports a bad file without stopping.

A missing file is fine. It means no settings.

## Read-only mode

The `--read-only` flag always turns it on. `GLUE_READ_ONLY` beats the settings file in
both directions, so `GLUE_READ_ONLY=0` lets one run write when the file says
`"readOnly": true`.

## Where tokens are stored

`glue login` tries the OS keychain first, and reads the token back to confirm it was
saved. When the keychain is closed, the token goes to `credentials.json` in the same
folder as the settings file. Only you can read that file on macOS and Linux. When that
file already exists and a new token goes to the keychain, the file is updated too, so
sessions that cannot reach the keychain do not keep using the old one.

| Variable | What it does |
|---|---|
| `GLUE_REFRESH_TOKEN` | Use this token, renew it as needed. Overrides the saved sign-in. |
| `GLUE_ACCESS_TOKEN` | Use this token. It cannot renew by itself. Overrides the saved sign-in. |
| `GLUE_USER_ID` | Use this user ID. |
| `GLUE_CLI_CREDENTIALS_FILE` | Keep the credentials file somewhere else. |
| `GLUE_CLI_CREDENTIAL_STORE` | `file` always uses the file. `memory` keeps tokens for one process only. |

If `glue` answers 401 after you sign in, check first for one of these variables in your
environment. `glue doctor` names any that are set.
