import { describe, expect, it } from 'vitest';
import { run, tempHome } from './helpers/cli.js';

const { home } = tempHome();

/** Every command people and agents rely on today. A removal must show up here as a failure. */
const COMMANDS = [
  'login', 'me', 'groups', 'directory', 'threads', 'thread', 'thread-activity', 'rename-audit',
  'message', 'delete-message', 'edit', 'react', 'quote', 'subthread', 'pin', 'unpin', 'people',
  'send', 'restore', 'tone', 'delete-thread', 'thread-add', 'thread-remove', 'thread-close',
  'thread-reopen', 'thread-update', 'group-create', 'group-delete', 'group-update',
  'group-members', 'group-add', 'group-remove', 'group-join', 'group-leave', 'guide',
  'draft-save', 'draft-send', 'draft-delete', 'mark-read', 'download', 'ai', 'pins',
  'pin-resource', 'unpin-resource', 'remind', 'unread', 'notifications', 'drafts', 'chats',
  'emojis', 'watch', 'config', 'logout', 'doctor', 'auth',
];

describe('command wiring', () => {
  it('registers every known command', async () => {
    const { stdout } = await run(['--help'], { home });
    const section = stdout.split(/^Commands:$/m)[1];
    const names = section
      .split('\n')
      .map((line) => line.match(/^ {2}([^\s|]+)/)?.[1])
      .filter((name): name is string => Boolean(name) && name !== 'help');
    expect(names.sort()).toEqual([...COMMANDS].sort());
  });

  it.each(['send', 'edit', 'quote', 'subthread', 'restore'])('%s declares --yes', async (name) => {
    const { stdout } = await run([name, '--help'], { home });
    expect(stdout).toMatch(/--yes\b/);
  });

  it.each(['--new', '--update', '--chat', '--attach', '--thread', '--to', '--subject'])(
    'send declares %s',
    async (flag) => {
      const { stdout } = await run(['send', '--help'], { home });
      expect(stdout).toContain(flag);
    },
  );

  it.each(['delete-message', 'delete-thread', 'group-delete', 'draft-delete', 'thread-close'])('%s is marked destructive and declares --yes and --dry-run', async (name) => {
    const { stdout } = await run([name, '--help'], { home });
    expect(stdout).toContain('(destructive)');
    expect(stdout).toMatch(/--yes\b/);
    expect(stdout).toMatch(/--dry-run\b/);
  });

  it('--json is declared once, on the root', async () => {
    const root = await run(['--help'], { home });
    expect(root.stdout).toContain('--json');
    // Each page is a new Node process, so they load in parallel to keep this fast on Windows.
    const pages = await Promise.all(COMMANDS.map(async (name) => ({ name, ...(await run([name, '--help'], { home })) })));
    for (const { name, stdout } of pages) {
      expect(stdout, name).not.toMatch(/^\s+--json\b/m);
    }
  });

  it('--pretty stays accepted but out of the help', async () => {
    const root = await run(['--help'], { home });
    expect(root.stdout).not.toContain('--pretty');
    const { stdout } = await run(['me', '--help'], { home });
    expect(stdout).not.toContain('--pretty');
  });
});
