import { ConfigError, fileErrorReason } from '../errors.js';
import { configDir } from '../paths.js';
import fs from 'fs';
import path from 'path';

const undoDir = () => path.join(configDir(), 'undo');
const TTL_DAYS = 7;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export interface UndoRecord {
  messageId: string;
  threadId?: string;
  previousText: string;
  savedAt: number;
}

export function undoPathFor(messageId: string): string {
  return path.join(undoDir(), `${messageId}.json`);
}

/**
 * Save the prior message body before it is overwritten by an updateMessage call.
 * Called from both the auto-update branch in `send` and from `edit`.
 */
export function saveUndo(messageId: string, previousText: string, threadId?: string): void {
  const record: UndoRecord = {
    messageId,
    threadId,
    previousText,
    savedAt: Date.now(),
  };
  try {
    fs.mkdirSync(undoDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(undoPathFor(messageId), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    // The edit has not happened yet. Without the saved text it could not be undone, so it stops here.
    throw new ConfigError(
      `Cannot save the message's current text for undo: ${fileErrorReason(error)}. The message was not changed.`,
      `Undo folder: ${undoDir()}`,
    );
  }
  pruneUndo();
}

export function loadUndo(messageId: string): UndoRecord | null {
  const file = undoPathFor(messageId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function deleteUndo(messageId: string): void {
  const file = undoPathFor(messageId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Sweep undo files older than the TTL. Called opportunistically by saveUndo. */
export function pruneUndo(): void {
  if (!fs.existsSync(undoDir())) return;
  const cutoff = Date.now() - TTL_MS;
  for (const name of fs.readdirSync(undoDir())) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(undoDir(), name);
    try {
      const stat = fs.statSync(file);
      // mtime is the cheap proxy; falls back to savedAt only if needed
      if (stat.mtimeMs < cutoff) fs.unlinkSync(file);
    } catch {
      // ignore single-file failures
    }
  }
}
