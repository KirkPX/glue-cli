import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue, message } from './helpers/fake-glue.js';

const home = tempHome();
const files = [{ __typename: 'File', id: 'fil_kept', url: 'https://example.invalid/f', name: 'f.pdf', contentType: 'application/pdf' }];

const glue = new FakeGlue({
  Thread: (variables) => ({
    node: {
      __typename: 'Thread',
      id: variables.threadId,
      subject: variables.threadId === 'thr_group' ? 'The Group' : 'A thread',
      threadType: variables.threadId === 'thr_group' ? 'groupChat' : 'thread',
      createdAt: '2026-01-01T00:00:00Z',
      closedAt: null,
      recipients: {
        __typename: 'RecipientConnection',
        edges: variables.threadId === 'thr_group'
          ? [{ __typename: 'RecipientEdge', node: { __typename: 'Group', id: 'grp_one', name: 'The Group' } }]
          : [],
      },
      messages: { __typename: 'MessageConnection', edges: [], totalCount: 0, pageInfo: { __typename: 'PageInfo', hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
    },
  }),
  SendMessage: (variables) => ({
    sendMessage: {
      __typename: 'SendMessagePayload',
      message: { ...message('msg_sent', variables.input.message.text), threadID: variables.input.threadID ?? 'thr_one' },
      thread: { __typename: 'Thread', id: variables.input.threadID ?? 'thr_one', subject: 'A thread', createdAt: '2026-01-01T00:00:00Z', replyToMessage: null },
    },
  }),
  Message: (variables) => ({ node: message(variables.messageId, 'the old body', files) }),
  UpdateMessage: (variables) => ({ updateMessage: message(variables.id, variables.input.text) }),
});

const send = (...args: string[]) => run(['send', ...args, '--yes'], { home: home.home, apiUrl: glue.url });
const lastSentFile = path.join(home.configDir, 'last-sent.json');

beforeAll(() => glue.start());
afterAll(async () => {
  await glue.stop();
  home.cleanup();
});
beforeEach(() => {
  glue.calls.length = 0;
  writeFileSync(lastSentFile, 'null');
});

describe('send safety', () => {
  it('refuses a group chat and prints the exact fix', async () => {
    const result = await send('hello', '--thread', 'thr_group');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('glue send "<text>" --to grp_one --subject "<subject>"');
    expect(glue.callsTo('SendMessage')).toHaveLength(0);
  });

  it('--chat posts to a group chat on purpose', async () => {
    const result = await send('hello', '--thread', 'thr_group', '--chat');
    expect(result.code).toBe(0);
    expect(glue.callsTo('SendMessage')).toHaveLength(1);
  });

  it('a first send creates a message and remembers it', async () => {
    const result = await send('first message about the budget', '--thread', 'thr_one');
    expect(result.code).toBe(0);
    expect(glue.callsTo('SendMessage')).toHaveLength(1);
    expect(JSON.parse(readFileSync(lastSentFile, 'utf8')).messageId).toBe('msg_sent');
  });

  it('a similar send within the window updates the message and saves an undo file', async () => {
    await send('first message about the budget', '--thread', 'thr_one');
    const result = await send('first message about the budgets', '--thread', 'thr_one');
    expect(result.code).toBe(0);
    expect(glue.callsTo('SendMessage')).toHaveLength(1);
    expect(glue.callsTo('UpdateMessage')).toHaveLength(1);
    expect(existsSync(path.join(home.configDir, 'undo', 'msg_sent.json'))).toBe(true);
  });

  it('a different send within the window is refused with the options', async () => {
    await send('first message about the budget', '--thread', 'thr_one');
    const result = await send('entirely unrelated words go here now!!', '--thread', 'thr_one');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('AMBIGUOUS SEND REFUSED');
    expect(result.stderr).toContain('--new');
    expect(glue.callsTo('SendMessage')).toHaveLength(1);
  });

  it('--new always creates a message', async () => {
    await send('first message about the budget', '--thread', 'thr_one');
    const result = await send('entirely unrelated words go here now!!', '--thread', 'thr_one', '--new');
    expect(result.code).toBe(0);
    expect(glue.callsTo('SendMessage')).toHaveLength(2);
  });

  it('--update replaces the message even when the text differs', async () => {
    await send('first message about the budget', '--thread', 'thr_one');
    const result = await send('entirely unrelated words go here now!!', '--thread', 'thr_one', '--update');
    expect(result.code).toBe(0);
    expect(glue.callsTo('UpdateMessage')).toHaveLength(1);
  });

  it('--new with --update is refused', async () => {
    const result = await send('hello', '--thread', 'thr_one', '--new', '--update');
    expect(result.code).toBe(1);
    expect(glue.callsTo('SendMessage')).toHaveLength(0);
  });

  it('a missing attachment stops the send and gives a hint', async () => {
    const result = await send('hello', '--thread', 'thr_one', '--attach', 'no-such-file.pdf');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).hint).toContain('--attach');
    expect(glue.callsTo('SendMessage')).toHaveLength(0);
  });
});

describe('the CLI never changes message text', () => {
  const text = 'Utilize this — "quoted" text... and a  double space';

  it('send delivers the text exactly, even with an old tone.json in place', async () => {
    writeFileSync(path.join(home.configDir, 'tone.json'), JSON.stringify({ voice: '', guidelines: [], vocabulary: [{ match: 'Utilize', alternatives: ['Use'] }], avoid: [] }));
    const result = await send(text, '--thread', 'thr_exact');
    expect(result.code).toBe(0);
    expect(glue.callsTo('SendMessage')[0].variables.input.message.text).toBe(text);
    expect(result.stderr).toBe('');
  });

  it('edit delivers the text exactly', async () => {
    await run(['edit', 'msg_exact', text, '--yes'], { home: home.home, apiUrl: glue.url });
    expect(glue.callsTo('UpdateMessage')[0].variables.input.text).toBe(text);
  });

  it('glue tone says when there is no tone file', async () => {
    const empty = tempHome();
    const result = await run(['tone'], { home: empty.home });
    expect(JSON.parse(result.stdout).configured).toBe(false);
    empty.cleanup();
  });
});

describe('edit and restore', () => {
  it('edit keeps the files already on the message', async () => {
    const result = await run(['edit', 'msg_1', 'new body', '--yes'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(0);
    expect(glue.callsTo('UpdateMessage')[0].variables.input).toEqual({ text: 'new body', attachments: ['fil_kept'] });
  });

  it('restore puts the saved text back and keeps the files', async () => {
    await run(['edit', 'msg_2', 'new body', '--yes'], { home: home.home, apiUrl: glue.url });
    glue.calls.length = 0;
    const result = await run(['restore', 'msg_2', '--yes'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(0);
    expect(glue.callsTo('UpdateMessage')[0].variables.input).toEqual({ text: 'the old body', attachments: ['fil_kept'] });
    expect(existsSync(path.join(home.configDir, 'undo', 'msg_2.json'))).toBe(false);
  });

  it('restore with nothing saved exits 1', async () => {
    const result = await run(['restore', 'msg_none', '--yes'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No undo entry');
  });
});
