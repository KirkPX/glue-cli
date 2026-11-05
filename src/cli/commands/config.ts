import { getConfigPath } from '../config-store.js';
import { loadSettings } from '../../settings.js';
import { reporter, type FormatOptions } from '../output.js';

export async function configPath(opts: FormatOptions = {}): Promise<void> {
  const path = getConfigPath();
  reporter(opts).result({ path }, path);
}

/** Print the validated settings. An invalid file fails here with the reason. */
export async function configShow(opts: FormatOptions = {}): Promise<void> {
  const settings = loadSettings();
  reporter(opts).result({ path: getConfigPath(), settings }, `${getConfigPath()}\n${JSON.stringify(settings, null, 2)}`);
}
