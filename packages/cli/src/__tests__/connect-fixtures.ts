import { cpSync, mkdtempSync, readdirSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../../test-fixtures/connect/', import.meta.url));

/**
 * Copies a fixture repo to a temp dir. Files named `dot.<rest>` become `.<rest>`,
 * because the repo .gitignore keeps files such as .mcp.json out of git.
 */
export function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `celune-connect-${name}-`));
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  restoreDotFiles(dir);
  return dir;
}

function restoreDotFiles(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) restoreDotFiles(full);
    else if (entry.startsWith('dot.')) renameSync(full, join(dir, entry.slice(3)));
  }
}
