import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DetectionReport, HarnessMatch, TemplateId } from './detect.js';
import { renderAdapter, renderEnvExample, renderHarnessConfig } from './templates.js';

export const SKILL_NAMES = ['celune-task', 'celune-project-plan', 'celune-status'] as const;
export const HARNESS_CONFIG_PATH = '.celune/harness.json';
export const ENV_EXAMPLE_PATH = '.env.celune.example';
const HARNESS_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export type FileAction = 'create' | 'overwrite' | 'skip' | 'unchanged';

export interface PlannedFile {
  /** Relative to the host root, forward slashes. */
  path: string;
  content: string;
  action: FileAction;
  added: number;
  removed: number;
}

export interface ScaffoldOptions {
  root: string;
  report: DetectionReport;
  /** Overrides the detected template. Required when nothing matched. */
  template?: TemplateId;
  harnessName?: string;
  apiUrl: string;
  workspaceId?: string;
  credentialEnv?: string;
  /** Directory for the adapter, relative to root. */
  outDir?: string;
  /** Relative to root. Null skips skill install; undefined picks .claude/skills when Claude Code is in use. */
  skillsDir?: string | null;
  force?: boolean;
  /** Where the bundled skills live. Tests pass it; the CLI finds its own. */
  skillsSource?: string;
}

export interface ScaffoldPlan {
  template: TemplateId;
  harnessName: string;
  match: HarnessMatch | null;
  files: PlannedFile[];
  /** Set when skills were not planned for install: where the bundled copies live. */
  skillsSourceHint: string | null;
}

export class NoTemplateError extends Error {
  constructor() {
    super('No known harness shape matched. Pass --template sdk-workstream, queue, or mcp.');
    this.name = 'NoTemplateError';
  }
}

/** Builds the file plan. Reads the host tree to compare, writes nothing. */
export function planScaffold(options: ScaffoldOptions): ScaffoldPlan {
  const { report, root } = options;
  const template = options.template ?? report.best?.template;
  if (!template) throw new NoTemplateError();
  const match =
    report.best?.template === template
      ? report.best
      : (report.candidates.find((c) => c.template === template) ?? null);
  const harnessName = options.harnessName ?? defaultHarnessName(root);
  if (!HARNESS_NAME_PATTERN.test(harnessName)) {
    throw new Error(
      `Harness name "${harnessName}" must be 1-100 letters, digits, dots, dashes, or underscores.`,
    );
  }
  const outDir = trimSlashes(options.outDir ?? 'celune');
  const adapterPath = `${outDir}/harness.ts`;
  const input = {
    harnessName,
    apiUrl: options.apiUrl,
    credentialEnv: options.credentialEnv ?? 'CELUNE_API_KEY',
    template,
    report,
    match,
    workspaceId: options.workspaceId ?? '<celune-workspace-id>',
    adapterPath,
  };

  const drafts: Array<{ path: string; content: string }> = [
    { path: adapterPath, content: renderAdapter(input) },
    { path: HARNESS_CONFIG_PATH, content: renderHarnessConfig(input) },
    { path: ENV_EXAMPLE_PATH, content: renderEnvExample(input) },
  ];

  const skillsDir =
    options.skillsDir === undefined
      ? report.claudeCode
        ? '.claude/skills'
        : null
      : options.skillsDir === null
        ? null
        : trimSlashes(options.skillsDir);
  const source = options.skillsSource ?? bundledSkillsDir();
  if (skillsDir) {
    for (const skill of SKILL_NAMES) {
      for (const file of listFiles(join(source, skill))) {
        drafts.push({
          path: `${skillsDir}/${skill}/${file}`,
          content: readFileSync(join(source, skill, file), 'utf8'),
        });
      }
    }
  }

  const files = drafts.map((draft) => planFile(root, draft, options.force ?? false));
  return { template, harnessName, match, files, skillsSourceHint: skillsDir ? null : source };
}

/** Writes create and overwrite entries. Never touches skip or unchanged entries. */
export function applyScaffold(root: string, plan: ScaffoldPlan): PlannedFile[] {
  const written: PlannedFile[] = [];
  for (const file of plan.files) {
    if (file.action !== 'create' && file.action !== 'overwrite') continue;
    const target = safeTarget(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    written.push(file);
  }
  return written;
}

export function formatPlan(plan: ScaffoldPlan, write: boolean): string[] {
  const symbol: Record<FileAction, string> = {
    create: '+',
    overwrite: '~',
    skip: '!',
    unchanged: '=',
  };
  const lines = plan.files.map((f) => {
    const detail =
      f.action === 'create'
        ? `create (+${f.added} lines)`
        : f.action === 'overwrite'
          ? `overwrite (+${f.added} -${f.removed} lines)`
          : f.action === 'skip'
            ? `skip: exists and differs (+${f.added} -${f.removed} lines); pass --force to overwrite`
            : 'unchanged';
    return `  ${symbol[f.action]} ${f.path}  ${detail}`;
  });
  const counts = countActions(plan.files);
  lines.push(
    '',
    `  ${counts.create} to create, ${counts.overwrite} to overwrite, ${counts.skip} skipped, ${counts.unchanged} unchanged` +
      (write ? '' : '. Dry run: nothing written. Pass --write to apply.'),
  );
  return lines;
}

export function countActions(files: PlannedFile[]): Record<FileAction, number> {
  const counts: Record<FileAction, number> = { create: 0, overwrite: 0, skip: 0, unchanged: 0 };
  for (const f of files) counts[f.action] += 1;
  return counts;
}

export function defaultHarnessName(root: string): string {
  let name = basename(resolve(root));
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof pkg.name === 'string' && pkg.name) name = pkg.name.replace(/^@[^/]+\//, '');
  } catch {
    // No package.json; the directory name stands in.
  }
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'host';
}

/** The skills/ directory that ships with the CLI, found from this module's location. */
export function bundledSkillsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'skills');
    if (existsSync(join(candidate, SKILL_NAMES[0], 'SKILL.md'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Bundled Celune skills not found next to the CLI');
}

function planFile(
  root: string,
  draft: { path: string; content: string },
  force: boolean,
): PlannedFile {
  const target = safeTarget(root, draft.path);
  const next = draft.content.split('\n');
  if (!existsSync(target)) {
    return { ...draft, action: 'create', added: countLines(draft.content), removed: 0 };
  }
  const current = readFileSync(target, 'utf8');
  if (current === draft.content) return { ...draft, action: 'unchanged', added: 0, removed: 0 };
  const { added, removed } = lineDelta(current.split('\n'), next);
  return { ...draft, action: force ? 'overwrite' : 'skip', added, removed };
}

/**
 * Resolves a scaffold path and refuses anything that lands outside the repo,
 * whether by `..`, a symlinked file, or a symlinked parent directory.
 */
export function safeTarget(root: string, path: string): string {
  const refuse = (why: string) =>
    new Error(`Refusing to write ${path}: ${why}. Remove it or pick another path.`);
  const base = resolve(root);
  const target = resolve(root, path);
  if (!target.startsWith(base + sep)) throw refuse('it is outside the repository');
  // No symlink anywhere between the repo root and the target, dangling or not.
  let current = base;
  for (const part of target.slice(base.length + 1).split(sep)) {
    current = join(current, part);
    if (!lexists(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw refuse(`${current.slice(base.length + 1)} is a symlink`);
    }
  }
  let ancestor = dirname(target);
  while (!lexists(ancestor)) ancestor = dirname(ancestor);
  const real = realpathSync(ancestor);
  const rootReal = realpathSync(root);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) {
    throw refuse('a parent directory resolves outside the repository');
  }
  return target;
}

function lexists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function lineDelta(before: string[], after: string[]): { added: number; removed: number } {
  const pool = new Map<string, number>();
  for (const line of before) pool.set(line, (pool.get(line) ?? 0) + 1);
  let kept = 0;
  for (const line of after) {
    const n = pool.get(line) ?? 0;
    if (n > 0) {
      pool.set(line, n - 1);
      kept += 1;
    }
  }
  return { added: after.length - kept, removed: before.length - kept };
}

function countLines(content: string): number {
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, `${prefix}${entry}/`));
    else out.push(`${prefix}${entry}`);
  }
  return out;
}

function trimSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+|^\/+|\/+$/g, '') || '.';
}
