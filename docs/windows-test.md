# Real Windows test

A person runs this before the first release, and again after a change to sign-in, install or storage. CI cannot show whether a browser opens or what a new user sees.

Steps: install from the README in a normal PowerShell window; open a new window and run `glue --version` and `glue doctor`; sign in with `glue login`, with `--email` and with `--paste`; confirm the key is in Credential Manager; run one list command at the terminal and piped to a file; read a file from a path with a space and a non-English character; try `--dry-run` and `--read-only`; press Ctrl-C at a prompt; uninstall and remove the saved key.

| Date | Version | Windows | Node | Result | Problems |
|---|---|---|---|---|---|
| 2026-11-06 | 2.1.0 | 11 | 24 | Pass for two testers: install, `glue login --email`, `glue me`, and a Claude Code skill reading a thread | PowerShell opened in `system32`, so the clone went there. Fixed: the steps now start with `cd ~`. Not run: Credential Manager check, piped output, paths with spaces, `--dry-run`, `--read-only`, Ctrl-C, uninstall |
