import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function groupCreateCommand(name: string, opts: GuardOptions) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would create group ${name}`)) return;
  validateConfig();
  const client = new GlueAPIClient();
  const result = await client.createGroup(name);

  if (r.format === 'pretty') {
    r.line(`Created group: ${result.name} (${result.id})`);
  } else {
    r.result(result);
  }
}
