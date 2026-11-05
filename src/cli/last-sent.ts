import { configDir } from '../paths.js';
import fs from 'fs';
import path from 'path';

const lastSentFile = () => path.join(configDir(), 'last-sent.json');

/** Window in ms — sends within this period to the same destination update instead of creating */
const UPDATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface LastSent {
  messageId: string;
  threadId: string;
  /** Sorted recipient IDs, if this was a --to send (so re-sends to same people match) */
  recipientKey?: string;
  timestamp: number;
  /** Body of the last sent message — used by the send-dedupe similarity gate */
  text?: string;
}

export function getLastSent(): LastSent | null {
  try {
    if (fs.existsSync(lastSentFile())) {
      return JSON.parse(fs.readFileSync(lastSentFile(), 'utf8'));
    }
  } catch {
    // Corrupted — ignore
  }
  return null;
}

export function saveLastSent(messageId: string, threadId: string, recipientIds?: string[], text?: string): void {
  const dir = path.dirname(lastSentFile());
  fs.mkdirSync(dir, { recursive: true });
  const data: LastSent = {
    messageId,
    threadId,
    recipientKey: recipientIds ? recipientIds.sort().join(',') : undefined,
    timestamp: Date.now(),
    text,
  };
  fs.writeFileSync(lastSentFile(), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

function isWithinWindow(last: LastSent): boolean {
  return Date.now() - last.timestamp <= UPDATE_WINDOW_MS;
}

export interface DedupeMatch {
  messageId: string;
  threadId: string;
  /** Prior body if recorded — callers compare against the new text to decide auto-update vs refuse */
  previousText?: string;
  /** ms since the prior send */
  elapsedMs: number;
}

/**
 * Check if the last message is a candidate for in-place update.
 * Matches on thread ID (for --thread replies) or recipient list (for --to sends).
 * Returns the match (including the prior body) or null. The caller decides
 * whether to auto-update or refuse based on content similarity.
 */
export function shouldUpdate(threadId?: string, recipientIds?: string[]): DedupeMatch | null {
  const last = getLastSent();
  if (!last || !isWithinWindow(last)) return null;

  const elapsedMs = Date.now() - last.timestamp;

  // Match by thread ID (replying to same thread)
  if (threadId && last.threadId === threadId) {
    return { messageId: last.messageId, threadId: last.threadId, previousText: last.text, elapsedMs };
  }

  // Match by recipients (sending to same people again via --to)
  if (recipientIds && recipientIds.length > 0 && last.recipientKey) {
    const currentKey = recipientIds.sort().join(',');
    if (last.recipientKey === currentKey) {
      return { messageId: last.messageId, threadId: last.threadId, previousText: last.text, elapsedMs };
    }
  }

  return null;
}
