// Shared helpers for thread subject-change ("rename") events.
//
// Rename events are NOT in Glue's GraphQL — they are GetStream messages with
// `type: "system"` whose text reads: `<Actor> changed the subject to "<NewName>"`.
// (Verified 2026-06-13 against captured channel history and a live rename.)
// A first rename arrives as a `message.new` Stream event; a repeat rename updates
// the same system message in place and arrives as `message.updated`.
//
// This module is the single source of truth for detecting/parsing those events,
// shared by `thread-activity`, `rename-audit`, and `watch --renames`, so the three
// stay consistent and the parser can be tested in isolation.

// Matches both straight and curly quotes around the new subject.
export const SUBJECT_CHANGE_RE = /changed the subject to ["“](.+?)["”]/;

/** Returns the new subject if `text` is a subject-change system message, else null. */
export function parseNewSubject(text?: string | null): string | null {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(SUBJECT_CHANGE_RE);
  return m ? m[1] : null;
}

export interface RenameRecord {
  threadId: string | null;
  messageId: string | null;
  actor: { id?: string; name?: string } | null;
  newSubject: string;
  at: string | null;
  via: string; // Stream event type (e.g. 'message.new'/'message.updated') or 'history'
}

/** Normalize a created_at that may be a Date (channel state) or string (raw API). */
function toISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Extract a RenameRecord from a GetStream *message object* (from channel.query /
 * channel.state.messages). Returns null if the message isn't a subject change.
 * `via` defaults to 'history' since a stored message has no live event type.
 */
export function renameFromMessage(m: any, via = 'history'): RenameRecord | null {
  if (!m || m.type !== 'system') return null;
  const newSubject = parseNewSubject(m.text);
  if (newSubject == null) return null;
  return {
    threadId: m.cid ? String(m.cid).replace(/^thread:/, '') : null,
    messageId: m.id ?? null,
    actor: m.user ? { id: m.user.id, name: m.user.name } : null,
    newSubject,
    at: toISO(m.created_at),
    via,
  };
}

/**
 * Extract a RenameRecord from a live GetStream *event* (message.new/updated).
 * Returns null if the event's message isn't a subject change.
 */
export function renameFromEvent(e: any): RenameRecord | null {
  const m = e?.message;
  if (!m || m.type !== 'system') return null;
  const newSubject = parseNewSubject(m.text);
  if (newSubject == null) return null;
  const threadId =
    (e.channel_id && String(e.channel_id)) ||
    (m.cid ? String(m.cid).replace(/^thread:/, '') : null) ||
    (e.cid ? String(e.cid).replace(/^thread:/, '') : null);
  return {
    threadId: threadId ?? null,
    messageId: m.id ?? null,
    actor: m.user ? { id: m.user.id, name: m.user.name } : null,
    newSubject,
    at: toISO(m.created_at) ?? toISO(e.created_at),
    via: e.type || 'unknown',
  };
}
