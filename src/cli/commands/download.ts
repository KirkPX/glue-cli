import { fileProblem } from '../read-file.js';
import * as fs from 'fs';
import * as path from 'path';
import { GlueAPIClient } from '../../client-graphql.js';
import { config, validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { TRANSFER_TIMEOUT_MS, request } from '../../client.js';
import { UsageError } from '../../errors.js';

const FILE_BASE = 'https://api.gluegroups.com/file';

interface PendingFile {
  id: string;
  url: string;
  name?: string;
  contentType?: string;
  fromMessage?: string;
}

// Collect File attachments referenced by a thread (thr_), message (msg_), or raw
// file (fil_) ID. Threads/messages carry full attachment metadata; a bare file
// ID is downloaded directly (filename resolved from Content-Disposition).
async function collectFiles(client: GlueAPIClient, id: string): Promise<PendingFile[]> {
  if (id.startsWith('fil_')) {
    return [{ id, url: `${FILE_BASE}/${id}/download` }];
  }

  if (id.startsWith('msg_')) {
    const m = await client.getMessage(id);
    if (!m) throw new UsageError(`Message not found: ${id}`, 'Confirm the ID with `glue message <msg_…>`.');
    return (m.attachments || [])
      .filter((a: any) => a?.id && a.url)
      .map((a: any) => ({ id: a.id, url: a.url, name: a.name, contentType: a.contentType, fromMessage: id }));
  }

  if (id.startsWith('thr_')) {
    const messages = await client.getAllThreadMessages(id);
    const files: PendingFile[] = [];
    for (const m of messages) {
      for (const a of m.attachments || []) {
        if (!a?.id || !a.url) continue;
        files.push({ id: a.id, url: a.url, name: a.name, contentType: a.contentType, fromMessage: m.id });
      }
    }
    return files;
  }

  throw new UsageError(`Unrecognized ID (expected thr_, msg_, or fil_): ${id}`);
}

// The sign-in goes only to Glue's own API host. A file URL can point at any storage host.
function isGlueUrl(url: string): boolean {
  try {
    return new URL(url).host === new URL(config.glue.apiUrl).host;
  } catch {
    return false;
  }
}

// Pull a filename out of a Content-Disposition header, if present.
function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*=(?:UTF-8'')?"?([^";]+)"?/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : undefined;
}

// Pick a non-colliding path in outDir, appending " (1)", " (2)", … like a browser.
function uniquePath(outDir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(outDir, name);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(outDir, `${stem} (${n})${ext}`);
    n++;
  }
  return candidate;
}

export async function downloadCommand(
  ids: string[],
  opts: { out?: string; pretty?: boolean }
) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const outDir = path.resolve(opts.out || process.cwd());
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (error) {
    throw new UsageError(`--out cannot use "${outDir}": ${fileProblem(error)}.`);
  }

  // Gather every referenced file across all IDs, deduped by file ID (the same
  // file can be attached to multiple messages — download it once).
  const pending: PendingFile[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const files = await collectFiles(client, id);
    for (const f of files) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      pending.push(f);
    }
  }

  if (pending.length === 0) {
    r.result({ downloaded: [], message: 'No file attachments found.' });
    return;
  }

  const token = config.glue.accessToken;
  const downloaded: any[] = [];
  const failed: any[] = [];

  for (const f of pending) {
    try {
      const res = await request(
        f.url,
        { headers: token && isGlueUrl(f.url) ? { Authorization: `Bearer ${token}` } : {} },
        { operation: `Download ${f.name || f.id}`, retry: 'safe', timeoutMs: TRANSFER_TIMEOUT_MS },
      );
      if (!res.ok) {
        failed.push({ id: f.id, name: f.name, status: res.status, statusText: res.statusText });
        continue;
      }
      const name =
        f.name || filenameFromDisposition(res.headers.get('content-disposition')) || f.id;
      const dest = uniquePath(outDir, name);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      downloaded.push({
        id: f.id,
        name,
        path: dest,
        size: buf.length,
        contentType: f.contentType || res.headers.get('content-type') || undefined,
        fromMessage: f.fromMessage,
      });
    } catch (err: any) {
      failed.push({ id: f.id, name: f.name, error: err?.message || String(err) });
    }
  }

  if (r.format === 'pretty') {
    r.line(`Downloaded ${downloaded.length} file(s) to ${outDir}:`);
    for (const d of downloaded) {
      r.line(`  ${d.path} (${d.size} bytes, ${d.contentType || 'unknown'})`);
    }
    if (failed.length) {
      r.line(`\nFailed (${failed.length}):`);
      for (const f of failed) {
        r.line(`  ${f.name || f.id}: ${f.error || f.statusText || f.status}`);
      }
    }
  } else {
    r.result({ outDir, downloaded, failed });
  }

  if (failed.length && downloaded.length === 0) process.exit(1);
}
