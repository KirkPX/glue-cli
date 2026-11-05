# Attachments

How files move in and out of Glue: `glue send --attach` to upload, `glue download` to pull them back down — what's supported, and why the implementations look the way they do.

- [Uploading (`send --attach`)](#uploading-send---attach)
- [Downloading (`glue download`)](#downloading-glue-download)

---

# Uploading (`send --attach`)

## Usage

```bash
glue send "<text>" --thread <id> --attach ./file.pdf
glue send "<text>" --to "<name>" --attach ./shot1.png ./shot2.png ./notes.txt
```

`--attach` accepts one or more local file paths. The CLI uploads each one before sending the message and includes the resulting file IDs in the `attachments` array of the `sendMessage` mutation.

## Supported file types

There is **no server-side restriction by file type**. The Glue API uses Box as its storage backend, and Box accepts everything we've thrown at it: PDFs, images (PNG/JPG/GIF/WebP/SVG), text, CSV, JSON, DOC/DOCX, XLS/XLSX, ZIP. The MIME-type map in `src/client-graphql.ts` is for setting the right `Content-Type` header during upload — extensions outside the map fall back to `application/octet-stream` and still upload fine.

Per-message limit: 10 attachments (set by Glue, not the CLI).

## Upload flow

Three GraphQL/HTTP steps for each file:

1. **`uploadTicket` mutation** — declare the file's name, content length, base64 MD5, and MIME type. The response is a union:
   - `File` — the file already exists on Glue (matching MD5); we use the returned `id` directly. No upload.
   - `UploadTicket` — contains a presigned `url`, required `headers`, and either `formData` (multipart POST) or none (raw PUT).

2. **PUT or POST to the presigned URL** — send the file bytes. Box currently returns `formData`, so we always go down the multipart POST path; the PUT branch is kept for forward-compat in case Glue swaps backends.

3. **`createFile` mutation** — register the upload by passing the ticket's `id`. Returns the canonical `File { id name }`. The `id` (e.g. `fil_xxx`) is what goes into `sendMessage`'s `attachments` array.

## Uploads use Node's fetch

The upload goes through `request()` in `src/client.ts`, which uses Node's built-in `fetch`. Keep it that way: `node-fetch` mishandles binary `FormData` bodies, and the storage backend answers them with 415.

## Error handling

Upload failures throw an `ApiError` (see `src/errors.ts`) with an explicit `hint` reminding the agent that an upload error is a **CLI bug, not a server restriction**. The hint exists because a prior agent hit the cross-fetch bug, concluded Glue's backend was image-only, and proposed image-only / email-instead workarounds. That diagnosis was wrong and wasted user time.

Stderr JSON shape:

```json
{ "error": true, "message": "File upload failed: 415 ...", "hint": "..." }
```

Always read `hint` before drawing conclusions. If a hint says "this is a CLI bug" — that is authoritative; do not pivot to workarounds.

---

# Downloading (`glue download`)

## Usage

```bash
glue download thr_ABC --out ./files     # every attachment across a whole thread
glue download msg_XYZ --out ./files     # just one message's attachments
glue download fil_123                   # one file by its own ID
glue download thr_A msg_B fil_C         # mix freely; deduped by file ID
```

`--out` defaults to the current working directory and is created if it doesn't exist.

## What each ID form does

The argument is any number of IDs, each resolved by prefix:

| Prefix | Resolution |
|--------|------------|
| `fil_` | Downloaded directly from `https://api.gluegroups.com/file/<id>/download`. No metadata lookup, so the filename comes from the response headers. |
| `msg_` | `getMessage` → the message's `attachments`, each of which carries its own `url`, `name`, and `contentType`. |
| `thr_` | `getAllThreadMessages` → walks **every** message in the thread and collects all attachments. |

Anything else exits with `Unrecognized ID (expected thr_, msg_, or fil_)`.

Note that only the bare `fil_` path constructs a URL. For `msg_`/`thr_`, the download URL comes from the attachment metadata Glue returns — the CLI doesn't assume the endpoint shape.

Files are **deduped by file ID** across all arguments, so the same file attached to five messages in a thread downloads once.

## Filename resolution

In priority order:

1. The attachment's `name` from Glue's metadata (the normal case for `msg_`/`thr_`).
2. The response's `Content-Disposition` header — both `filename*=UTF-8''…` (percent-decoded) and plain `filename="…"` are parsed. This is the usual source for a bare `fil_` ID.
3. The raw file ID, as a last resort.

Collisions inside `--out` get a browser-style suffix: `report.pdf`, `report (1).pdf`, `report (2).pdf`. Nothing is ever overwritten.

## Output

JSON by default:

```json
{
  "outDir": "/abs/path/to/files",
  "downloaded": [
    { "id": "fil_…", "name": "shot.png", "path": "/abs/path/to/files/shot.png",
      "size": 48210, "contentType": "image/png", "fromMessage": "msg_…" }
  ],
  "failed": []
}
```

`fromMessage` tells you which message a file came from — useful when pulling a whole thread. With `--pretty` you get a readable list plus a failure summary.

**Partial failures are not fatal.** Each file is fetched independently; a non-OK response or network error lands in `failed` (with `status`/`statusText` or `error`) and the rest continue. The command exits **1 only if every file failed** — so a zero exit does *not* mean nothing failed. Check `failed` if you care.

A thread with no attachments is a success, not an error: `{ "downloaded": [], "message": "No file attachments found." }`.

## Two limits worth knowing

- **No type filter.** `glue download` pulls *all* attachments — there's no `--type image`. Each result carries `contentType`, so filter after the fact (the files are already on disk by then). If you want to look before pulling, `glue message <id> --pretty` lists a message's attachments first.
- **Only real File attachments.** The GraphQL selection is `attachments { ... on File { id url name contentType } }`. An image that was merely *pasted as a URL into message text* is plain text as far as the CLI is concerned and will not be downloaded.

## Implementation pointers

### Upload
- `src/client-graphql.ts::uploadFile` — three-step flow
- `src/cli/commands/send.ts` — wires `--attach` paths through `uploadFile` then into `sendMessage`
- `src/errors.ts` — `ApiError` and `UsageError` with `hint`
- `src/index.ts` — global handler that surfaces `hint` in stderr JSON

### Download
- `src/cli/commands/download.ts` — `collectFiles` (ID resolution), `filenameFromDisposition`, `uniquePath`, fetch loop
- `src/client-graphql.ts` — the `attachments { ... on File … }` selection on `getMessage` / thread queries
