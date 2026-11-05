import { writeFileSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue, message } from './helpers/fake-glue.js';

const home = tempHome();
const readThread = (id: string) => ({
  node: { __typename: 'Thread', id, subject: 'S', threadType: 'thread', recipients: { edges: [] }, messages: { edges: [] } },
});
const glue = new FakeGlue({
  Thread: (v) => readThread(v.threadId),
  Message: (v) => ({ node: message(v.messageId, 'old', []) }),
  DeleteMessage: () => ({ deleteMessage: true }),
  DeleteThread: () => ({ deleteThread: true }),
  SendMessage: (v) => ({
    sendMessage: {
      message: message('msg_sent', v.input.message.text),
      thread: { id: 'thr_one', subject: 's', createdAt: 'x', replyToMessage: null },
    },
  }),
});
const opts = (env: Record<string, string> = {}) => ({ home: home.home, apiUrl: glue.url, env });

/** Every command that changes data, with arguments that reach its change. */
const CHANGES: string[][] = [
  ['send', 'hello', '--thread', 'thr_one', '--yes'],
  ['edit', 'msg_1', 'text', '--yes'],
  ['quote', 'msg_1', 'text', '--yes'],
  ['react', 'msg_1', 'thumbsup'],
  ['subthread', 'msg_1', 'text', '--to', 'usr_x', '--yes'],
  ['pin', 'msg_1'],
  ['unpin', 'msg_1'],
  ['delete-message', 'msg_1', '--yes'],
  ['delete-thread', 'thr_1', '--yes'],
  ['thread-add', 'thr_1', 'usr_x'],
  ['thread-remove', 'thr_1', 'usr_x'],
  ['thread-close', 'thr_1', '--yes'],
  ['thread-reopen', 'thr_1'],
  ['thread-update', 'thr_1', '--subject', 's'],
  ['group-create', 'g'],
  ['group-delete', 'grp_1', '--yes'],
  ['group-update', 'grp_1', '--name', 'n'],
  ['group-add', 'grp_1', 'usr_x'],
  ['group-remove', 'grp_1', 'usr_x'],
  ['group-join', 'grp_1'],
  ['group-leave', 'grp_1'],
  ['draft-save', 'text', '--to', 'usr_x'],
  ['draft-send', 'dft_1'],
  ['draft-delete', 'dft_1', '--yes'],
  ['mark-read', 'thr_1'],
  ['ai', 'thr_1', 'prompt'],
  ['pin-resource', 'thr_1', 'res_1'],
  ['unpin-resource', 'pin_1'],
  ['remind', 'thr_1', '2h'],
];

beforeAll(() => glue.start());
afterAll(async () => {
  await glue.stop();
  home.cleanup();
});
beforeEach(() => {
  glue.calls.length = 0;
});

const changesSent = () => glue.calls.filter((c) => !['Thread', 'Message'].includes(c.operationName));

describe('read-only mode', () => {
  it.each(CHANGES)('--read-only stops %s before it reaches the server', async (...args) => {
    const result = await run([...args, '--read-only'], opts());
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).message).toContain('Read-only');
    expect(glue.calls).toHaveLength(0);
  });

  it('GLUE_READ_ONLY=1 stops a change', async () => {
    const result = await run(['pin', 'msg_1'], opts({ GLUE_READ_ONLY: '1' }));
    expect(result.code).toBe(1);
    expect(glue.calls).toHaveLength(0);
  });

  it('the settings file stops a change, and GLUE_READ_ONLY=0 lets one run through', async () => {
    const file = path.join(home.home, 'read only settings.json');
    writeFileSync(file, JSON.stringify({ readOnly: true }));
    const stopped = await run(['delete-message', 'msg_1', '--yes'], opts({ GLUE_CLI_CONFIG_FILE: file }));
    expect(JSON.parse(stopped.stderr).message).toContain('Read-only');
    const allowed = await run(['delete-message', 'msg_1', '--yes'], opts({ GLUE_CLI_CONFIG_FILE: file, GLUE_READ_ONLY: '0' }));
    expect(allowed.code).toBe(0);
  });

  it('reads still work', async () => {
    const result = await run(['message', 'msg_1', '--read-only'], opts());
    expect(result.code).toBe(0);
  });
});

describe('--dry-run', () => {
  it.each(CHANGES)('%s reports the change and sends none', async (...args) => {
    const result = await run([...args, '--dry-run'], opts());
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true, changed: false, ok: true });
    expect(changesSent()).toEqual([]);
  });

  it('a dry-run send leaves the dedupe record alone', async () => {
    await run(['send', 'hello there friend', '--thread', 'thr_two', '--yes', '--dry-run'], opts());
    const real = await run(['send', 'something else entirely now', '--thread', 'thr_two', '--yes'], opts());
    expect(real.code).toBe(0);
    expect(glue.callsTo('SendMessage')).toHaveLength(1);
  });
});

describe('deletes need consent', () => {
  it.each([
    ['delete-message', 'msg_1'],
    ['delete-thread', 'thr_1'],
    ['group-delete', 'grp_1'],
    ['draft-delete', 'dft_1'],
  ])('%s with no --yes, in a script, changes nothing, exits 1 and says why', async (...args) => {
    const result = await run(args, opts());
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ aborted: true, changed: false, ok: false });
    expect(JSON.parse(result.stdout).hint).toContain('--yes');
    expect(glue.calls).toHaveLength(0);
  });

  it('--yes deletes', async () => {
    const result = await run(['delete-message', 'msg_1', '--yes'], opts());
    expect(result.code).toBe(0);
    expect(glue.callsTo('DeleteMessage')).toHaveLength(1);
  });

  it('restore with no --yes, in a script, changes nothing', async () => {
    await run(['edit', 'msg_9', 'new', '--yes'], { ...opts(), apiUrl: glue.url });
    glue.calls.length = 0;
    const result = await run(['restore', 'msg_9'], opts());
    expect(result.code).toBe(1);
    expect(changesSent()).toEqual([]);
  });
});

describe('closing and bulk changes need consent', () => {
  it.each([
    ['thread-close', 'thr_1'],
    ['mark-read', 'thr_1', 'thr_2'],
  ])('%s with no --yes, in a script, changes nothing and says why', async (...args) => {
    const result = await run(args, opts());
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).hint).toContain('--yes');
    expect(glue.calls).toHaveLength(0);
  });
});

describe('messages need consent', () => {
  it.each([
    ['send', 'hello', '--thread', 'thr_one'],
    ['edit', 'msg_1', 'text'],
  ])('%s with no --yes, in a script, says to pass --yes and sends nothing', async (...args) => {
    const result = await run(args, opts());
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).hint).toContain('--yes');
    expect(changesSent()).toEqual([]);
  });
});
