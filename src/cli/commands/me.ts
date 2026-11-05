import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function meCommand(opts: { pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  const me = await client.getMe();

  if (r.format === 'pretty') {
    r.line(`${me.name} (${me.id})`);
    if (me.bio) r.line(`  ${me.bio}`);
    if (me.profile?.emailAddress) r.line(`  Email: ${me.profile.emailAddress}`);
    if (me.profile?.timezone) r.line(`  Timezone: ${me.profile.timezone}`);
    if (me.profile?.location) r.line(`  Location: ${me.profile.location}`);
  } else {
    r.result(me);
  }
}
