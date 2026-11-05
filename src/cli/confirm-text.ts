import { createInterface } from 'node:readline';
import { UsageError } from '../errors.js';
import { ask } from './ask.js';

/**
 * Show a message and ask before sending it. Returns the text to send, or null if cancelled.
 * The text goes out exactly as given or typed here. The CLI never changes it.
 */
export async function confirmText(text: string): Promise<string | null> {
  // With no terminal, nothing can answer the prompt. Say so, rather than end with nothing sent.
  if (!process.stdin.isTTY) {
    throw new UsageError('This command asks for confirmation, and there is no terminal to ask at.', 'Pass --yes to confirm.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    console.error(`\n  Message: ${text}\n`);
    const answer = (await ask(rl, '  Send? [Y]es / [n]o / [e]dit: ')).trim().toLowerCase();
    if (answer === 'n' || answer === 'no') return null;
    if (answer === 'e' || answer === 'edit') {
      const edited = (await ask(rl, '  New text: ')).trim();
      return edited || null;
    }
    return text;
  } finally {
    rl.close();
  }
}
