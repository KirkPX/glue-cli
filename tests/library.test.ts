import { pathToFileURL } from 'url';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('library entry', () => {
  it('exports what programs import, without running the CLI', async () => {
    const lib = await import(pathToFileURL(path.resolve(import.meta.dirname, '../dist/lib.js')).href);
    for (const name of [
      'GlueAPIClient', 'config', 'validateConfig', 'TokenRefreshService', 'readConfig', 'writeConfig',
      'resolveToken', 'getConfigPath', 'CacheService', 'getCache', 'StreamService',
      'STREAM_CHANNEL_TYPE',
    ]) {
      expect(lib[name], name).toBeDefined();
    }
  });
});
