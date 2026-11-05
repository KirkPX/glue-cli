import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue, message } from './helpers/fake-glue.js';

const home = tempHome();
const glue = new FakeGlue({
  Me: () => ({
    me: {
      __typename: 'User',
      id: 'usr_test',
      name: 'Test User',
      avatarURL: null,
      bio: 'Tester',
      profile: { __typename: 'Profile', emailAddress: 'test@example.com', timezone: 'UTC', location: 'Nowhere' },
    },
  }),
  Message: (variables) => ({ node: message(variables.messageId, 'hello there') }),
  Thread: (variables) => ({
    node: variables.threadId === 'thr_missing' ? null : {
      id: variables.threadId,
      subject: 'S',
      threadType: 'thread',
      recipients: { edges: [] },
      messages: { edges: [
        { node: message('msg_1', 'one') },
        { node: { ...message('msg_2', 'two'), createdAt: '2026-01-02T00:00:00Z' } },
      ] },
    },
  }),
});

beforeAll(() => glue.start());
afterAll(async () => {
  await glue.stop();
  home.cleanup();
});

describe('reading', () => {
  it('me prints JSON and sends the access token', async () => {
    const result = await run(['me'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).id).toBe('usr_test');
    expect(glue.callsTo('Me')[0].authorization).toBe('Bearer test-access-token');
  });

  it('me --pretty prints readable text', async () => {
    const result = await run(['me', '--pretty'], { home: home.home, apiUrl: glue.url });
    expect(result.stdout).toContain('Test User (usr_test)');
    expect(result.stdout).toContain('Email: test@example.com');
  });

  it('message returns the message by id', async () => {
    const result = await run(['message', 'msg_1'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).text).toBe('hello there');
  });

  it('a thread that does not exist gets a plain message and a next step', async () => {
    const result = await run(['thread', 'thr_missing'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(1);
    const error = JSON.parse(result.stderr);
    expect(error.message).toContain('Thread not found');
    expect(error.hint).toContain('glue threads');
  });

  it('thread takes a pasted link', async () => {
    const result = await run(['thread', 'https://app.example.com/threads/thr_abc123?x=1'], { home: home.home, apiUrl: glue.url });
    expect(JSON.parse(result.stdout).id).toBe('thr_abc123');
  });

  it('thread --limit never returns more than asked, even if the server does', async () => {
    const newest = await run(['thread', 'thr_a', '--limit', '1'], { home: home.home, apiUrl: glue.url });
    expect(JSON.parse(newest.stdout).messages.map((m: any) => m.id)).toEqual(['msg_2']);
    const oldest = await run(['thread', 'thr_a', '--limit', '1', '--oldest'], { home: home.home, apiUrl: glue.url });
    expect(JSON.parse(oldest.stdout).messages.map((m: any) => m.id)).toEqual(['msg_1']);
  });

  it('a server error exits non-zero and writes no result', async () => {
    const result = await run(['groups'], { home: home.home, apiUrl: glue.url });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error).toBe(true);
  });
});
