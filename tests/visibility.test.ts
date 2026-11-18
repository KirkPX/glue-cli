import { writeFileSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertGlueLinks } from '../src/cli/glue-links.js';
import { threadVisibility, toRecipientRole } from '../src/visibility.js';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue, message } from './helpers/fake-glue.js';

const WKS = { id: 'wks_one', name: 'Test Workspace' };
const PERSON = { id: 'usr_other', name: 'Other Person' };
const recipients = (nodes: Array<{ id: string; name: string }>) => ({
  edges: nodes.map((node) => ({ node, subscription: node.id.startsWith('wks_') ? 'activity' : 'inbox' })),
  totalCount: nodes.length,
});
// thr_public already lists the workspace. Every other thread is private.
const threadRecipients = (id: string) => (id === 'thr_public' ? [PERSON, WKS] : [PERSON]);

const home = tempHome();
const glue = new FakeGlue({
  Workspace: () => ({ workspace: { ...WKS } }),
  Thread: (v) => ({
    node: { id: v.threadId, subject: 'S', threadType: 'thread', recipients: recipients(threadRecipients(v.threadId)), messages: { edges: [] } },
  }),
  FetchThreadRecipients: (v) => ({
    node: {
      recipients: {
        ...recipients(threadRecipients(v.id)),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  }),
  AddThreadRecipients: (v) => ({
    addThreadRecipients: { id: v.id, subject: 'S', recipients: recipients([PERSON, ...v.recipients.map((r: any) => (r.recipient === WKS.id ? WKS : { id: r.recipient, name: r.recipient }))]) },
  }),
  RemoveThreadRecipients: (v) => ({
    removeThreadRecipients: { id: v.id, subject: 'S', recipients: recipients([PERSON, WKS].filter((n) => !v.recipientIDs.includes(n.id))) },
  }),
  UpdateThread: (v) => ({ updateThread: { id: v.id, subject: v.input.subject, recipients: recipients(threadRecipients(v.id)) } }),
  GroupWorkspace: (v) => ({ node: { id: v.id, workspaceID: 'wks_one' } }),
  UpdateGroup: (v) => ({ updateGroup: { id: v.id, name: 'G', joinableBy: v.input.joinableBy === 'none' ? 'approval' : (v.input.joinableBy ?? 'approval') } }),
  Groups: () => ({
    groups: { edges: [{ node: { id: 'grp_one', name: 'G', description: null, memberCount: 2, joinableBy: 'workspace' } }], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: 1 },
  }),
  SendMessage: (v) => ({
    sendMessage: { message: message('msg_sent', v.input.message.text), thread: { id: 'thr_new', subject: 's', createdAt: 'x', replyToMessage: null } },
  }),
  SendDraft: (v) => ({
    sendDraft: { id: 'thr_sub', subject: v.input.subject ?? null, createdAt: 'x', parentThread: { id: 'thr_parent', subject: 'P' }, firstMessage: message('msg_first', v.input.message.text) },
  }),
});
beforeAll(() => glue.start());
afterAll(async () => {
  await glue.stop();
  home.cleanup();
});
beforeEach(() => {
  glue.calls.length = 0;
  writeFileSync(path.join(home.configDir, 'last-sent.json'), 'null');
});
const opts = () => ({ home: home.home, apiUrl: glue.url });
const json = (stdout: string) => JSON.parse(stdout);
const mutations = () => glue.calls.filter((c) => /^(Add|Remove|Update|Send)/.test(c.operationName));

describe('visibility helpers', () => {
  it('a thread is public when the workspace is a recipient', () => {
    expect(threadVisibility([PERSON, WKS])).toEqual({ visibility: 'public', publicTo: WKS });
    expect(threadVisibility([PERSON])).toEqual({ visibility: 'private', publicTo: null });
  });

  it('the workspace always goes in as activity, never inbox', () => {
    expect(toRecipientRole('wks_one')).toEqual({ recipient: 'wks_one', subscription: 'activity' });
    expect(toRecipientRole({ recipient: 'wks_one', subscription: 'inbox' })).toEqual({ recipient: 'wks_one', subscription: 'activity' });
    expect(toRecipientRole('usr_a')).toEqual({ recipient: 'usr_a' });
  });
});

describe('thread-update --public and --private', () => {
  it('--public adds the workspace with the activity subscription', async () => {
    const result = await run(['thread-update', 'thr_private', '--public'], opts());
    expect(result.code).toBe(0);
    const [call] = glue.callsTo('AddThreadRecipients');
    expect(call.variables).toEqual({ id: 'thr_private', recipients: [{ recipient: 'wks_one', subscription: 'activity' }] });
    expect(json(result.stdout)).toMatchObject({ visibility: 'public', publicTo: WKS });
    expect(glue.callsTo('UpdateThread')).toHaveLength(0);
  });

  it('takes a pasted link as well as an ID', async () => {
    await run(['thread-update', 'https://app.glue.ai/thr_private/msg_x', '--public'], opts());
    expect(glue.callsTo('AddThreadRecipients')[0].variables.id).toBe('thr_private');
  });

  it('--public on a public thread changes nothing', async () => {
    const result = await run(['thread-update', 'thr_public', '--public'], opts());
    expect(result.code).toBe(0);
    expect(mutations()).toHaveLength(0);
    expect(json(result.stdout)).toMatchObject({ visibility: 'public', note: 'The thread was already public.' });
  });

  it('--private removes the workspace', async () => {
    const result = await run(['thread-update', 'thr_public', '--private'], opts());
    expect(result.code).toBe(0);
    expect(glue.callsTo('RemoveThreadRecipients')[0].variables).toEqual({ id: 'thr_public', recipientIDs: ['wks_one'] });
    expect(json(result.stdout).visibility).toBe('private');
  });

  it('--dry-run says what would happen and calls nothing', async () => {
    const result = await run(['thread-update', 'thr_private', '--public', '--dry-run'], opts());
    expect(result.code).toBe(0);
    expect(glue.calls).toHaveLength(0);
    expect(result.stdout).toMatch(/everyone in the workspace can open it/);
  });

  it('--subject alone never sends a visibility field', async () => {
    await run(['thread-update', 'thr_private', '--subject', 'New'], opts());
    expect(glue.callsTo('UpdateThread')[0].variables.input).toEqual({ subject: 'New' });
  });
});

describe('group-update sets who can join', () => {
  it('--public sends joinableBy workspace, not isPublic', async () => {
    const result = await run(['group-update', 'grp_one', '--public'], opts());
    expect(result.code).toBe(0);
    expect(glue.callsTo('UpdateGroup')[0].variables.input).toEqual({ joinableBy: 'workspace', workspaceID: 'wks_one' });
    expect(json(result.stdout).joinableBy).toBe('workspace');
  });

  it('--private sends joinableBy approval', async () => {
    await run(['group-update', 'grp_one', '--private'], opts());
    expect(glue.callsTo('UpdateGroup')[0].variables.input).toEqual({ joinableBy: 'approval', workspaceID: 'wks_one' });
  });

  it('fails when Glue keeps the old setting without an error', async () => {
    const result = await run(['group-update', 'grp_one', '--joinable', 'none'], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/kept who can join G at approval, not none/);
  });

  it('--name alone sends no joinableBy and no workspace lookup', async () => {
    await run(['group-update', 'grp_one', '--name', 'H'], opts());
    expect(glue.callsTo('UpdateGroup')[0].variables.input).toEqual({ name: 'H' });
    expect(glue.callsTo('GroupWorkspace')).toHaveLength(0);
  });

  it('--joinable refuses an unknown value before any call', async () => {
    const result = await run(['group-update', 'grp_one', '--joinable', 'everyone'], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/workspace, approval, domain, none/);
    expect(glue.calls).toHaveLength(0);
  });

  it('--dry-run calls nothing', async () => {
    const result = await run(['group-update', 'grp_one', '--joinable', 'workspace', '--dry-run'], opts());
    expect(result.code).toBe(0);
    expect(glue.calls).toHaveLength(0);
  });

  it('groups --json shows joinableBy', async () => {
    const result = await run(['groups'], opts());
    expect(json(result.stdout)[0].joinableBy).toBe('workspace');
  });
});

describe('thread shows whether it is public', () => {
  it('--json holds visibility and publicTo', async () => {
    expect(json((await run(['thread', 'thr_public'], opts())).stdout)).toMatchObject({ visibility: 'public', publicTo: WKS });
    expect(json((await run(['thread', 'thr_private'], opts())).stdout)).toMatchObject({ visibility: 'private', publicTo: null });
  });
});

describe('send --public', () => {
  it('starts the thread, then adds the workspace as activity', async () => {
    const result = await run(['send', 'hi', '--to', 'usr_other', '--public', '--yes'], opts());
    expect(result.code).toBe(0);
    expect(glue.callsTo('SendMessage')[0].variables.input.thread.recipients).toEqual(['usr_other']);
    expect(glue.callsTo('AddThreadRecipients')[0].variables).toEqual({ id: 'thr_new', recipients: [{ recipient: 'wks_one', subscription: 'activity' }] });
  });

  it('a wks_ ID in --to is the same as --public', async () => {
    await run(['send', 'hi', '--to', 'usr_other', 'wks_one', '--yes'], opts());
    expect(glue.callsTo('SendMessage')[0].variables.input.thread.recipients).toEqual(['usr_other']);
    expect(glue.callsTo('AddThreadRecipients')).toHaveLength(1);
  });

  it('refuses --public with --thread and names the command that does it', async () => {
    const result = await run(['send', 'hi', '--thread', 'thr_private', '--public', '--yes'], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('glue thread-update thr_private --public');
    expect(mutations()).toHaveLength(0);
  });

  it('without --public, a new thread stays private', async () => {
    await run(['send', 'hi', '--to', 'usr_other', '--yes'], opts());
    expect(glue.callsTo('AddThreadRecipients')).toHaveLength(0);
  });
});

describe('subthread visibility', () => {
  const roles = () => glue.callsTo('SendDraft')[0].variables.input.recipientRoles;

  it('--public adds the workspace as activity', async () => {
    const result = await run(['subthread', 'thr_private', 'hi', '--public', '--yes'], opts());
    expect(result.code).toBe(0);
    expect(roles()).toContainEqual({ recipient: 'wks_one', subscription: 'activity' });
  });

  it('a subthread of a public thread starts public, with the workspace as activity', async () => {
    await run(['subthread', 'thr_public', 'hi', '--yes'], opts());
    expect(roles().filter((r: any) => r.recipient === 'wks_one')).toEqual([{ recipient: 'wks_one', subscription: 'activity' }]);
  });

  it('--private leaves the workspace out of a public parent', async () => {
    await run(['subthread', 'thr_public', 'hi', '--private', '--yes'], opts());
    expect(roles().map((r: any) => r.recipient)).not.toContain('wks_one');
  });

  it('a private parent gives a private subthread', async () => {
    await run(['subthread', 'thr_private', 'hi', '--yes'], opts());
    expect(roles().map((r: any) => r.recipient)).not.toContain('wks_one');
  });
});

describe('thread-add takes the workspace ID', () => {
  it('adds wks_ as activity without a name search', async () => {
    const result = await run(['thread-add', 'thr_private', 'wks_one'], opts());
    expect(result.code).toBe(0);
    expect(glue.callsTo('AddThreadRecipients')[0].variables.recipients).toEqual([{ recipient: 'wks_one', subscription: 'activity' }]);
  });
});

describe('Glue links with an escaped underscore', () => {
  it('passes good links and text without links', () => {
    expect(() => assertGlueLinks('see https://app.glue.ai/thr_a/msg_b and snake\\_case')).not.toThrow();
  });

  it('refuses thr\\_ and thr%5C_ and shows the fix', () => {
    expect(() => assertGlueLinks('see https://app.glue.ai/thr\\_a/msg\\_b')).toThrow(/backslash/);
    try {
      assertGlueLinks('[x](https://app.glue.ai/thr%5C_a)');
    } catch (error: any) {
      expect(error.hint).toContain('https://app.glue.ai/thr_a');
    }
  });

  it('send refuses before any call', async () => {
    const result = await run(['send', 'see https://app.glue.ai/thr\\_a', '--to', 'usr_other', '--yes'], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('https://app.glue.ai/thr_a');
    expect(glue.calls).toHaveLength(0);
  });

  it('edit refuses before any call', async () => {
    const result = await run(['edit', 'msg_x', 'https://app.glue.ai/thr%5C_a', '--yes'], opts());
    expect(result.code).toBe(1);
    expect(glue.calls).toHaveLength(0);
  });
});
