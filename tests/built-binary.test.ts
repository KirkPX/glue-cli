import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { run, tempHome } from './helpers/cli.js';

const home = tempHome();

describe('built binary', () => {
  it('--help lists usage', async () => {
    const result = await run(['--help'], { home: home.home });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: glue');
  });

  it('--version matches package.json', async () => {
    const result = await run(['--version'], { home: home.home });
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'));
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('guide prints the agent reference', async () => {
    const result = await run(['guide'], { home: home.home });
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(500);
  });

  it('a command with no sign-in exits non-zero with a JSON error on stderr', async () => {
    const result = await run(['me'], { home: home.home, signedOut: true });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr).error).toBe(true);
  });
});
