import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

export async function emojisCommand(opts: { search?: string; pretty?: boolean }) {
  const r = reporter(opts);
  validateConfig();
  const client = new GlueAPIClient();
  let emojis = await client.getCustomEmojis();
  if (opts.search) {
    const q = opts.search.toLowerCase();
    emojis = emojis.filter((e: any) => e.name.toLowerCase().includes(q));
  }

  if (r.format === 'pretty') {
    r.line(`Custom emojis: ${emojis.length}`);
    for (const e of emojis) {
      r.line(`  :${e.name}:  ${e.imageUrl}`);
    }
  } else {
    r.result(emojis);
  }
}
