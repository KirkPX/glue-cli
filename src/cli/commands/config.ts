import { getConfigPath } from '../config-store.js';
import { loadSettings, setSetting, unsetSetting } from '../../settings.js';
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

/** Set one setting, so nobody has to edit or copy the file by hand. */
export async function configSet(name: string, value: string, opts: FormatOptions = {}): Promise<void> {
  const settings = setSetting(name, value);
  reporter(opts).result({ path: getConfigPath(), name, settings }, `Set ${name}.`);
}

export async function configUnset(name: string, opts: FormatOptions = {}): Promise<void> {
  const removed = unsetSetting(name);
  reporter(opts).result({ path: getConfigPath(), name, removed }, removed ? `Removed ${name}.` : `${name} was not set.`);
}
