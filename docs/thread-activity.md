# Thread Activity & Rename Events — how it works

Glue's GraphQL API does **not** expose thread timeline events (subject changes,
"replied with sub-thread", etc.). The `node(Thread).messages` connection returns
only real user messages (`type: regular`). The web app renders its timeline from
the thread's **GetStream channel**, where each event is a message with
`type: "system"`. The CLI reads that channel through its existing `StreamService`
(auth = the stream token derived from the CLI's own Bearer token — the same path
`glue react` and `glue watch` already use).

## The two backends, and which one has the events

### 1. GraphQL `FetchThread` — does NOT contain timeline events

The web app's thread fetch (`FetchThread` / `FetchThreadMetadata`, sent as
Automatic Persisted Queries — hash only, no query body on the wire) carries zero
occurrences of "changed the subject", no `Activity`/`Event`/`SubjectChange`
typename, and a `messages` connection of plain `Message` nodes. This matches what
`glue thread` returns. **GraphQL simply does not expose rename events.**

### 2. GetStream channel query — the actual source

- **Endpoint shape:** `POST https://chat.stream-io-api.com/channels/thread/<thr_id>/query`
- **Auth:** GetStream JWT issued by Glue (`iss: glue-api`) — same token
  `StreamService` obtains via `getStreamConfig().streamToken`.
- **Channel addressing:** channel type = `thread`, channel id = the thread id
  (matches the CLI's `STREAM_CHANNEL_TYPE = 'thread'`).
- **Events live at:** `response.messages[]` where `message.type === "system"`.

A subject-change event (anonymized example):

```json
{
  "id": "msg_XXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "type": "system",
  "text": "Alex Example changed the subject to \"Roadmap\"",
  "created_at": "2026-06-13T17:21:40.023511Z",
  "user": { "id": "usr_XXXXXXXXXXXXXXXXXXXXXXXXXXX", "name": "Alex Example" }
}
```

Field mapping for an audit:

| Audit field | GetStream path |
|---|---|
| event kind | `type` (`"system"`; subject change identified by text pattern `changed the subject to "<X>"`) |
| actor | `user.id` / `user.name` |
| new subject | parsed from `text` → regex `changed the subject to ["“](.+?)["”]` |
| timestamp | `created_at` (ISO 8601) |
| event id | `id` |

The same channel's `system` messages also carry other timeline events (e.g.
"<name> replied to a message with [sub-thread]") — so this is the **broader
activity timeline**, of which subject-changes are one kind.

## The commands built on this

**Shared helper:** `src/cli/rename.ts` — single source of truth for
detecting/parsing subject-change events (`parseNewSubject`, `renameFromMessage`,
`renameFromEvent`). Unit-tested against captured payloads: straight quotes (live
event), curly quotes (channel history), threadId-from-`cid`, and non-rename
system messages correctly ignored.

### `glue thread-activity <id>`
View a thread's activity timeline from its GetStream channel.
- `--renames` — filter to subject-change events only, with `newSubject` parsed out
- `--limit <n>` — how many channel messages to scan (default 200)
- `--pretty` — human-readable

Chosen over `glue thread <id> --activity` so the activity timeline isn't mixed
into the existing `thread` JSON contract that downstream tools may depend on.

### `glue rename-audit`
Sweep recent threads for rename history (e.g. auditing adoption of a
thread-naming convention).
- Flags: `--threads <n>` (default 50), `--limit <n>` (msgs/channel, default 200),
  `--concurrency <n>` (default 8), `--rate <perMin>` (default 50 — GetStream
  rate-limits around 60 channel queries/min), `--pretty`
- Mechanism: enumerate threads via GraphQL `searchThreads` (read-only), then read
  each thread's GetStream channel and collect subject-change events. Batched
  concurrency; per-thread failures are counted, not fatal.

### `glue watch --renames`
Real-time rename feed as structured NDJSON:
`{ threadId, messageId, actor, newSubject, at, via }`.

A first rename arrives as `message.new`; a repeat rename **updates the same
system message in place** and arrives as `message.updated` (same `messageId`) —
`glue watch` subscribes to both, so neither is missed.

## Caveats / known limits

- **No old-subject in the event.** Glue records only the new subject per change.
  Reconstruct before/after by ordering successive subject-change events.
- **System messages can be pruned.** GetStream retention may age out very old
  rename events — a sweep sees recent history, not all of it.
- **Visibility scope.** Only threads the authenticated user is a recipient of are
  visible; there is no workspace-wide server query (the data isn't in GraphQL).
- **Repeat-rename timestamp nuance.** For a `message.updated` rename, `at` is the
  original system message's `created_at`, not the instant of the latest rename.
  The event itself is delivered in real time and `newSubject` is current — use
  event arrival as the trigger time if the distinction matters.
- **`--limit` paging.** Scans up to `--limit` recent channel messages; for very
  old renames in huge threads, add `created_at_before` pagination over
  `channel.query`.
