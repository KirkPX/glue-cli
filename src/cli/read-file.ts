import { readFile } from 'node:fs/promises';
import { UsageError } from '../errors.js';

/** Read a text file named by an option, as UTF-8. A failure names the option and file in plain words. */
export async function readOptionFile(option: string, file: string): Promise<string> {
  try {
    return await readFile(file, 'utf-8');
  } catch (error) {
    throw new UsageError(`${option} cannot read "${file}": ${fileProblem(error)}.`);
  }
}

export function fileProblem(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return 'the file does not exist';
  if (code === 'EISDIR') return 'it is a folder, not a file';
  if (code === 'EACCES' || code === 'EPERM') return 'you do not have permission';
  return code ?? 'unknown error';
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * The text of a message: the argument, or --text-file. PowerShell strips double quotes inside
 * arguments, and long text does not belong on a command line, so every command that takes message
 * text can read it from a file, or from standard input with `-`.
 */
export async function messageText(text: string | undefined, opts: { textFile?: string }): Promise<string> {
  if (text !== undefined && opts.textFile) {
    throw new UsageError('Give the text as an argument or with --text-file, not both.');
  }
  if (text !== undefined) return text;
  if (!opts.textFile) {
    throw new UsageError('No text given.', 'Pass the text as an argument, or use --text-file <path>, or --text-file - for standard input.');
  }
  const body = opts.textFile === '-' ? await readStdin() : await readOptionFile('--text-file', opts.textFile);
  const trimmed = body.replace(/\r?\n$/, '');
  if (!trimmed.trim()) throw new UsageError('The text is empty.');
  return trimmed;
}
