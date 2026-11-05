import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

// glue pins <threadId> — list pinned resources
export async function pinsCommand(threadId: string, opts: GuardOptions) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const pins = await client.getPinnedResources(threadId);

  if (r.format === 'pretty') {
    r.line(`Pinned resources: ${pins.length}`);
    for (const p of pins) {
      const item = p.resource || {};
      const label = item.name || item.subject || item.id || '(resource)';
      r.line(`  ${p.title || label} [${item.__typename}] — pin ${p.id}`);
    }
  } else {
    r.result(pins);
  }
}

// glue pin-resource <threadId> <resourceId>
export async function pinResourceCommand(threadId: string, resourceId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would pin ${resourceId} to thread ${threadId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const pinned = await client.pinResource(threadId, resourceId);
  if (r.format === 'pretty') {
    r.line(`Pinned ${resourceId} to ${threadId} (${pinned?.id})`);
  } else {
    r.result(pinned);
  }
}

// glue unpin-resource <pinnedResourceId>
export async function unpinResourceCommand(pinnedResourceId: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would unpin ${pinnedResourceId}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const ok = await client.unpinResource(pinnedResourceId);
  if (r.format === 'pretty') {
    r.line(ok ? `Unpinned ${pinnedResourceId}` : `Not unpinned: ${pinnedResourceId}`);
  } else {
    r.result({ success: ok, id: pinnedResourceId });
  }
}
