# Send safety — dedupe, similarity gate, undo

`glue send` has a 5-minute dedupe window. When you send to the same thread (or the same `--to` recipient list) twice within that window, the CLI tries to decide whether the second send is a *revision* of the first or a *new message*. Earlier the decision was timer-only — any second send inside the window silently replaced the first. That heuristic caused real message clobbers when two consecutive sends were on different topics.

The current behavior keeps the convenience of auto-update for genuine revisions but refuses to act when the bodies look like different topics, and preserves the prior body in a local undo log either way.

## Decision tree

When you run `glue send ...`:

1. **`--new` is passed** → always post a fresh message. No dedupe check.
2. **No prior send within 5 min to the same thread / recipients** → post fresh.
3. **Prior send exists + new body ≥ 70% similar to the prior body** → auto-update the prior message in place. The prior body is saved to the undo log first. This is the revision case (typo fixes, tone tweaks, small rewrites).
4. **Prior send exists + new body < 70% similar** → **refuse with exit code 2**. Nothing is sent or overwritten. The CLI prints the prior message preview, the new preview, the similarity %, and the three escape hatches:
   - `--new` to post as a separate message
   - `--update` to explicitly replace the previous one
   - `glue edit <id> "<text>"` to replace a specific message by ID

Similarity uses Levenshtein-ratio over the message body (`src/cli/similarity.ts`). Threshold is `0.70`.

## Refusal output

When branch 4 triggers, the CLI writes the following to stderr and exits with code 2:

```
AMBIGUOUS SEND REFUSED — likely a different topic, not a correction.

Previous message:
  id:        msg_3E2ewRqO...
  sent:      47 seconds ago
  preview:   "Standup moved to 10am tomorrow — same room, calendar updated..."

New message (similarity 12%):
  preview:   "Q3 report draft is up — comments welcome through Friday..."

Reflect: is this a correction, or a new message on a new topic?
  --new                Post as a new message
  --update             Replace the previous message (was the implicit behavior)
  glue edit msg_3E2ewRqO... "<text>"   Replace a specific message by ID

Re-run with one of these flags to proceed.
```

The "Reflect:" line is deliberate — it's there to cue a calling agent to stop and decide which branch matches intent before re-running, rather than blindly retrying.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Generic error (missing flag, missing file, missing undo entry, …) |
| `2` | Ambiguous send refused — re-run with `--new`, `--update`, or `glue edit` |

Scripts that wrap `glue send` should branch on these — exit 2 specifically means "the CLI declined to act, decide explicitly," not "a transport error happened."

## Undo & restore

Every in-place message update — whether from the auto-dedupe path in `send` or from explicit `glue edit` — writes the prior body to `undo/<msg_id>.json in the settings folder` *before* calling `updateMessage`. Files auto-prune after **7 days**.

To revert:

```bash
glue restore <msg_id>
```

`glue restore` reads the undo file, asks for confirmation (skippable with `-y`), calls `updateMessage` with the prior body, then deletes the undo entry. It's a one-way revert — if you need to redo, the new text is still in your shell history.

If the undo file is missing or older than 7 days, `glue restore` exits 1 with a message pointing at the undo dir.

## Why this exists

A timer-based heuristic that auto-updates within a window saves keystrokes when you're iterating on a single message, but it has no way to distinguish "I want to tweak what I just said" from "I want to send a second, different message." The latter case is common — drafting a follow-up while the first is still on screen — and silent overwrites of the first message lose work.

The fix changes the heuristic in three ways:

1. **Pre-action, not post-action** — refuses to act on ambiguity rather than guessing and hoping the user notices.
2. **Non-zero exit** — stops the calling script or agent instead of letting it move on assuming success.
3. **Names the conflict explicitly** — shows previous message ID, elapsed time, similarity score, and previews so the caller can decide instead of guessing.

The undo log covers the residual case: even when auto-update *does* fire (revision case), if it turns out to have been wrong, the prior body is recoverable.

## Tested scenarios

The behavior is validated against a dedicated test group (e.g. `glue group-create __cli-test`) per the no-live-mutations rule:

- Similar rerun within 5 min → auto-updates and writes undo
- Distinct-topic rerun within 5 min → exit code 2, structured refusal
- `--new` bypasses the gate (always posts fresh)
- `--update` bypasses the gate (always replaces the prior message)
- `glue restore <msg_id>` reverts and deletes the undo entry
- Files older than 7 days in the undo dir are pruned on the next send

See `src/cli/similarity.ts`, `src/cli/last-sent.ts`, `src/cli/undo.ts`, `src/cli/commands/send.ts`, `src/cli/commands/edit.ts`, `src/cli/commands/restore.ts` for the implementation.
