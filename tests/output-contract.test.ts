import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run, tempHome } from './helpers/cli.js';
import { FakeGlue } from './helpers/fake-glue.js';

const COMMANDS = path.resolve(import.meta.dirname, '../src/cli/commands');

// A source check on purpose: it fails on a new command written the old way.
describe('output contract', () => {
  it('no command writes to stdout directly', () => {
    const offenders = readdirSync(COMMANDS).filter((name) =>
      /(^|[^.\w])console\.log\s*\(/.test(readFileSync(path.join(COMMANDS, name), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('no handler reuses the name r for anything but its Reporter', () => {
    // `r` is typed any in a loop over untyped data, so typecheck would not catch r.line on it.
    const offenders = readdirSync(COMMANDS).filter((name) =>
      /\bconst r of\b|\bconst r = (?!reporter)/.test(readFileSync(path.join(COMMANDS, name), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

const home = tempHome();
const glue = new FakeGlue({
  Me: () => ({ me: { __typename: 'User', id: 'usr_test', name: 'Test User', avatarURL: null, bio: null, profile: null } }),
});
const opts = () => ({ home: home.home, apiUrl: glue.url });

beforeAll(() => glue.start());
afterAll(async () => {
  await glue.stop();
  home.cleanup();
});

describe('flags through the built CLI', () => {
  it('a piped run is JSON with no flag', async () => {
    const { stdout } = await run(['me'], opts());
    expect(JSON.parse(stdout).id).toBe('usr_test');
  });

  it('--json works before and after the command', async () => {
    for (const args of [['--json', 'me'], ['me', '--json']]) {
      const { stdout } = await run(args, opts());
      expect(JSON.parse(stdout).id).toBe('usr_test');
    }
  });

  it('--pretty works before and after the command, in a pipe', async () => {
    for (const args of [['--pretty', 'me'], ['me', '--pretty']]) {
      const { stdout } = await run(args, opts());
      expect(stdout).toContain('Test User (usr_test)');
    }
  });

  it('an error with --pretty is plain text with its next step', async () => {
    const { stderr, code } = await run(['me', '--pretty'], { home: home.home, signedOut: true });
    expect(code).toBe(1);
    expect(stderr).toContain('Error: Not signed in.');
    expect(stderr).toContain('glue login');
  });

  it('--verbose adds a stack to the JSON error, still one object', async () => {
    const { stderr } = await run(['me', '--verbose'], { home: home.home, signedOut: true });
    expect(JSON.parse(stderr).stack).toContain('Not signed in');
  });

  it('a closed pipe does not end in a stack trace', async () => {
    const { stderr, code } = await run(['guide'], { home: home.home });
    expect(code).toBe(0);
    expect(stderr).toBe('');
  });
});
