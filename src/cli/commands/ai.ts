import { assertWritable, reportDryRun, type GuardOptions } from '../guardrails.js';
import { GlueAPIClient } from '../../client-graphql.js';
import { validateConfig } from '../../config.js';
import { reporter } from '../output.js';

// glue ai <contextThreadId> "<prompt>" — ask Glue AI about a thread.
// Creates an AI session anchored to the context thread, then polls the session
// thread for the agent's reply. Continue the conversation with `glue send --thread <sessionThreadId>`.
export async function aiCommand(contextThreadId: string, prompt: string, opts: GuardOptions & { wait?: string; cancel?: boolean;  }) {
  const r = reporter(opts);
  assertWritable(opts);
  if (reportDryRun(opts, r, `Would ask Glue AI in thread ${contextThreadId}: ${prompt}`)) return;
  validateConfig();
  const client = new GlueAPIClient();

  const session = await client.createAISession(contextThreadId, prompt);
  const sessionThreadId = session.sessionThread?.id;

  // Poll the session thread for the agent's reply (default ~15s). The agent posts a
  // "Thinking…" placeholder first, then streams the answer by editing it in place — so
  // wait until an agent message has settled (non-empty, not "Thinking…", not ending in "…").
  const waitMs = parseInt(opts.wait || '15000', 10);
  let messages: any[] = [];
  const settled = (text: string) => {
    const t = (text || '').trim();
    return t.length > 0 && t !== 'Thinking...' && t !== 'Thinking…' && !t.endsWith('...') && !t.endsWith('…');
  };
  if (sessionThreadId && waitMs > 0) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      messages = await client.getAllThreadMessages(sessionThreadId);
      const agentReply = messages.find((m, i) => i > 0 && settled(m.text));
      if (agentReply) break;
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  if (opts.cancel && session.id) {
    await client.cancelAISession(session.id);
  }

  if (r.format === 'pretty') {
    r.line(`AI session ${session.id} → thread ${sessionThreadId}`);
    r.line('---');
    for (const m of messages) {
      r.line(`\n${m.user.name}:`);
      r.line(m.text);
    }
    if (messages.length < 2) r.line('\n(no reply yet — read later with: glue thread ' + sessionThreadId + ')');
    r.line(`\nContinue: glue send "<follow-up>" --thread ${sessionThreadId}`);
  } else {
    r.result({ sessionID: session.id, sessionThreadId, messages });
  }
}
