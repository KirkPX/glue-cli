import { ConfigError, fileErrorReason } from '../../errors.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from '../../paths.js';
import { reporter, type FormatOptions } from '../output.js';

/**
 * Print the tone file: plain writing for whoever drafts a message. Read it before drafting.
 * The CLI applies nothing from it. What you send is what goes out.
 */
export async function toneCommand(opts: FormatOptions = {}): Promise<void> {
  const path = join(configDir(), 'tone.md');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigError(`Cannot read the tone file: ${fileErrorReason(error)}.`, `Tone file: ${path}`);
    }
    reporter(opts).result({ configured: false, path }, `No tone file. To add one, create ${path}`);
    return;
  }
  reporter(opts).result({ configured: true, path, text }, text.trimEnd());
}
