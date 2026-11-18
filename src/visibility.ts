// Who can open a thread, and who can join a group.
//
// A thread is public when its workspace is one of its recipients. The Glue web app makes a
// thread public by adding the workspace with the 'activity' subscription, and private by
// removing it. 'activity' matters: with 'inbox', the thread would land in every inbox in
// the workspace.
//
// A group's joinableBy says who can join it: 'workspace' (Open: anyone in the workspace),
// 'approval' (Ask to join), 'domain' (anyone with the workspace's email domain) or 'none'.

export type Subscription = 'inbox' | 'activity' | 'archive';

export interface RecipientRole {
  recipient: string;
  subscription?: Subscription;
}

export const JOINABLE_BY = ['workspace', 'approval', 'domain', 'none'] as const;
export type JoinableBy = (typeof JOINABLE_BY)[number];

export const isWorkspaceId = (id: string): boolean => id.startsWith('wks_');

/** The role a recipient goes in with. A workspace is always 'activity', never an inbox. */
export function toRecipientRole(value: string | RecipientRole): RecipientRole {
  const role = typeof value === 'string' ? { recipient: value } : value;
  return isWorkspaceId(role.recipient) ? { recipient: role.recipient, subscription: 'activity' } : role;
}

export interface Visibility {
  visibility: 'public' | 'private';
  /** The workspace the thread is public to, when it is public. */
  publicTo: { id: string; name: string } | null;
}

/** Public when a workspace is among the recipients. */
export function threadVisibility(recipients: Array<{ id: string; name: string }>): Visibility {
  const workspace = recipients.find((r) => isWorkspaceId(r.id));
  return workspace
    ? { visibility: 'public', publicTo: { id: workspace.id, name: workspace.name } }
    : { visibility: 'private', publicTo: null };
}
