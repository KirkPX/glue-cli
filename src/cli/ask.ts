import type { Interface } from 'node:readline';
import { InterruptedError } from '../errors.js';

/**
 * Ask one question on an open readline interface.
 *
 * Ctrl-C closes the interface and rejects with InterruptedError. Closing it
 * takes the terminal out of raw mode, so typing shows again after a masked
 * prompt. Without a SIGINT listener, readline only pauses, and the process
 * ends with exit code 0 as if the person had answered.
 */
export function ask(rl: Interface, question: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    rl.once('SIGINT', () => {
      rl.close();
      reject(new InterruptedError());
    });
    rl.question(question, resolve);
  });
}
