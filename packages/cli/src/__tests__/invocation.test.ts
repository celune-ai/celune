import { describe, expect, it } from 'vitest';
import { cliCommand } from '../invocation.js';

describe('cliCommand', () => {
  it('names the scoped package when launched through npx', () => {
    expect(cliCommand('/home/u/.npm/_npx/ab12/node_modules/.bin/celune')).toBe('npx @celuneai/cli');
  });

  it('names the scoped package when launched through pnpm dlx', () => {
    expect(cliCommand('/home/u/.cache/pnpm/dlx/xyz/node_modules/.bin/celune')).toBe(
      'npx @celuneai/cli',
    );
  });

  it('names the installed bin otherwise', () => {
    expect(cliCommand('/usr/local/bin/celune')).toBe('celune');
    expect(cliCommand(undefined)).toBe('celune');
  });
});
