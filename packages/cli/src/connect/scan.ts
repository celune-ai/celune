import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

/** Directories that hold dependencies or build output. Skipped even when tracked. */
export const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.vercel',
  '.output',
  'coverage',
  'storybook-static',
  '.venv',
  'venv',
  '__pycache__',
  'vendor',
  'target',
  'fixtures',
  '__fixtures__',
  'test-fixtures',
]);

const SCANNED_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|prisma|json|toml|ya?ml|md)$/;
const MAX_FILES = 8_000;
const MAX_BYTES = 256 * 1024;

export interface ScannedFile {
  /** Path relative to the scan root, with forward slashes. */
  path: string;
  content: string;
}

export interface ScanResult {
  root: string;
  files: ScannedFile[];
  /** Every listed path, including ones not read (for example `.claude/` entries). */
  paths: string[];
  truncated: boolean;
}

/**
 * Reads the host repository without writing to it. Inside a git work tree the
 * file list comes from git, so .gitignore rules apply exactly. Elsewhere a
 * directory walk applies the root .gitignore with a small glob matcher.
 */
export function scanRepository(root: string): ScanResult {
  const listed = listWithGit(root) ?? listWithWalk(root);
  const paths = listed.filter((p) => !p.split('/').some((part) => SKIPPED_DIRS.has(part))).sort();
  const files: ScannedFile[] = [];
  let truncated = false;
  for (const path of paths) {
    if (!SCANNED_EXT.test(path) && !/(^|\/)requirements[^/]*\.txt$/.test(path)) continue;
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    const full = join(root, path);
    try {
      const stat = statSync(full);
      if (!stat.isFile() || stat.size > MAX_BYTES) continue;
      files.push({ path, content: readFileSync(full, 'utf8') });
    } catch {
      // Unreadable files (broken links, permissions) do not stop the scan.
    }
  }
  return { root, files, paths, truncated };
}

function listWithGit(root: string): string[] | null {
  try {
    const inside = execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (inside !== 'true') return null;
    const out = execFileSync(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
    );
    // Deleted but still-indexed files show up in --cached; keep only ones on disk.
    return out
      .split('\0')
      .filter(Boolean)
      .filter((p) => existsSync(join(root, p)));
  } catch {
    return null;
  }
}

function listWithWalk(root: string): string[] {
  const ignore = loadGitignore(root);
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      const isDir = entry.isDirectory();
      if (isDir && SKIPPED_DIRS.has(entry.name)) continue;
      if (ignore(rel, isDir)) continue;
      if (isDir) walk(full);
      else if (entry.isFile()) out.push(rel);
      if (out.length > MAX_FILES * 4) return;
    }
  };
  walk(root);
  return out;
}

/** Root .gitignore only. Negations are not supported and are skipped. */
export function loadGitignore(root: string): (path: string, isDir: boolean) => boolean {
  let text = '';
  try {
    text = readFileSync(join(root, '.gitignore'), 'utf8');
  } catch {
    return () => false;
  }
  const rules = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map(toRule);
  return (path, isDir) => rules.some((rule) => rule(path, isDir));
}

function toRule(pattern: string): (path: string, isDir: boolean) => boolean {
  const dirOnly = pattern.endsWith('/');
  let body = dirOnly ? pattern.slice(0, -1) : pattern;
  const anchored = body.includes('/');
  if (body.startsWith('/')) body = body.slice(1);
  const regex = new RegExp(`^${globToRegex(body)}$`);
  return (path, isDir) => {
    if (dirOnly && !isDir) return false;
    return anchored ? regex.test(path) : regex.test(posix.basename(path));
  };
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return out;
}
