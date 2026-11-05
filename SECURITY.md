# Security policy

Report a vulnerability privately through
[GitHub's security advisory form](https://github.com/KirkPX/glue-cli/security/advisories/new).
Do not open a public issue. Only the latest release is supported.

## How the CLI handles your sign-in

- `glue login` saves your tokens to the OS keychain.
- Where the keychain is closed, such as over SSH on macOS, the tokens go to a
  credentials file in the settings folder. On macOS and Linux only you can read
  that file (mode 600, in a folder with mode 700). On Windows it relies on your
  profile folder's permissions.
- A sign-in made by an earlier version also keeps a copy in that file, so SSH
  sessions stay signed in. Later saves update both places. `glue logout` clears both.
- `GLUE_REFRESH_TOKEN` and `GLUE_ACCESS_TOKEN` take a token from the environment.
  Tokens are not taken as command arguments, because those stay in shell history.
- Error messages remove tokens, and API responses are not printed raw.
- The sign-in goes only to Glue's API host. A file download from any other host
  carries no sign-in.
- The sign-in page listens on `127.0.0.1` only, and accepts a token only with a
  one-time value that it issues itself. Glue signs in only through Firebase, so
  that page loads Firebase's library, pinned to one version. It loads nothing else.

The settings file never holds a token.

## Files the CLI keeps

The settings folder also holds your last sent message, recent message text saved
for `glue restore` (kept for 7 days), and a list of the people and groups you have
looked up. On macOS and Linux only you can read the message files.
