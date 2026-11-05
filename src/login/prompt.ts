import { createInterface, type Interface } from "node:readline";
import { ask } from "../cli/ask.js";

/**
 * Read a secret from the terminal without echoing it.
 *
 * The prompt goes to stderr so a piped `--json` run keeps stdout clean. This is
 * the fallback when there is no browser to hand off to — SSH, a headless box,
 * or a locked-down desktop — so every CLI with a browser login MUST also have
 * this path.
 */
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input: read it plainly. There is no terminal to echo to.
    return (await readAllStdin()).trim();
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  // readline has no masking, so suppress its echo while the answer is typed.
  const muted = rl as Interface & {
    _writeToOutput?: (text: string) => void;
    output?: NodeJS.WritableStream;
  };
  let masking = false;
  muted._writeToOutput = (text: string) => {
    if (masking && !text.includes(question)) return;
    muted.output?.write(text);
  };

  try {
    const pending = ask(rl, question);
    masking = true;
    const answer = await pending;
    process.stderr.write("\n");
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await ask(rl, question)).trim();
  } finally {
    rl.close();
  }
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
