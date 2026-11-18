import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { UsageError } from '../../errors.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';
import { idFrom } from '../resolve.js';
import { isWorkspaceId, threadVisibility } from '../../visibility.js';

// --public adds the workspace to the thread's recipients, the way the Glue web app does.
// Everyone in the workspace can then open the thread and links to its messages. Nobody gets
// it in their inbox. --private removes the workspace again.
export async function threadUpdateCommand(idOrLink: string, opts: GuardOptions & { subject?: string; public?: boolean; private?: boolean }) {
  const r = reporter(opts);
  assertWritable(opts);
  if (opts.public && opts.private) {
    throw new UsageError('cannot set both --public and --private');
  }
  if (!opts.subject && !opts.public && !opts.private) {
    throw new UsageError('provide --subject, --public, or --private to update');
  }
  const id = idFrom(idOrLink, 'thr');

  const changes: string[] = [];
  if (opts.subject) changes.push(`set the subject to "${opts.subject}"`);
  if (opts.public) changes.push('make it public: add the workspace as a recipient, so everyone in the workspace can open it (nobody gets it in their inbox)');
  if (opts.private) changes.push('make it private: remove the workspace, so only its recipients can open it');
  if (reportDryRun(opts, r, `Would update thread ${id}: ${changes.join('; ')}`)) return;
  validateConfig();

  const client = new GlueAPIClient();
  let result: any;
  let note: string | undefined;

  if (opts.public || opts.private) {
    const thread = await client.getThread(id, 1);
    const recipients = thread.recipients?.edges?.map((e: any) => e.node) ?? [];
    const workspaces = recipients.filter((n: any) => isWorkspaceId(n.id)).map((n: any) => n.id);
    if (opts.public && workspaces.length > 0) {
      note = 'The thread was already public.';
    } else if (opts.public) {
      const workspace = await client.getWorkspace();
      result = await client.addThreadRecipients(id, [{ recipient: workspace.id, subscription: 'activity' }]);
    } else if (workspaces.length === 0) {
      note = 'The thread was already private.';
    } else {
      result = await client.removeThreadRecipients(id, workspaces);
    }
  }

  if (opts.subject) {
    result = await client.updateThread(id, { subject: opts.subject });
  }
  if (!result) {
    // Nothing changed: read the thread so the output still shows where it stands.
    const thread = await client.getThread(id, 1);
    result = { id: thread.id, subject: thread.subject, recipients: thread.recipients };
  }

  const recipients = result.recipients?.edges?.map((e: any) => e.node) || [];
  const visibility = threadVisibility(recipients);

  if (r.format === 'pretty') {
    r.line(`Updated thread: ${result.subject || '(No subject)'} (${result.id})`);
    if (note) r.line(note);
    r.line(visibility.publicTo
      ? `Visibility: public. Everyone in ${visibility.publicTo.name} can open it.`
      : 'Visibility: private. Only its recipients can open it.');
    if (recipients.length > 0) {
      r.line(`Recipients (${result.recipients.totalCount ?? recipients.length}):`);
      for (const item of recipients) {
        const label = item.id.startsWith('grp_') || isWorkspaceId(item.id) ? `[${item.name}]` : item.name;
        r.line(`  ${label} (${item.id})`);
      }
    }
  } else {
    r.result({ ...result, ...visibility, ...(note ? { note } : {}) });
  }
}
