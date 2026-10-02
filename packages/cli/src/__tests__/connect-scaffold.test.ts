import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectHarness } from '../connect/detect.js';
import {
  applyScaffold,
  bundledSkillsDir,
  countActions,
  formatPlan,
  NoTemplateError,
  planScaffold,
  safeTarget,
  SKILL_NAMES,
} from '../connect/scaffold.js';
import { renderAdapter } from '../connect/templates.js';
import { copyFixture } from './connect-fixtures.js';

const API = 'http://localhost:4000';
const dirs: string[] = [];
function fixture(name: string): string {
  const dir = copyFixture(name);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function plan(root: string, extra: Partial<Parameters<typeof planScaffold>[0]> = {}) {
  return planScaffold({ root, report: detectHarness(root), apiUrl: API, ...extra });
}

describe('planScaffold dry run', () => {
  it('plans the SDK adapter, config, env example, and skills without writing', () => {
    const root = fixture('headways');
    const result = plan(root);
    expect(result.template).toBe('sdk-workstream');
    expect(result.harnessName).toBe('headways-shaped');
    expect(result.files.map((f) => [f.path, f.action])).toEqual([
      ['celune/harness.ts', 'create'],
      ['.celune/harness.json', 'create'],
      ['.env.celune.example', 'create'],
      ['.claude/skills/celune-task/SKILL.md', 'create'],
      ['.claude/skills/celune-project-plan/SKILL.md', 'create'],
      ['.claude/skills/celune-status/SKILL.md', 'create'],
    ]);
    for (const f of result.files) expect(existsSync(join(root, f.path))).toBe(false);

    const summary = formatPlan(result, false).join('\n');
    expect(summary).toContain('+ celune/harness.ts  create (+');
    expect(summary).toContain(
      '6 to create, 0 to overwrite, 0 skipped, 0 unchanged. Dry run: nothing written.',
    );

    const adapter = result.files[0]!.content;
    expect(adapter).toContain('export class HeadwaysShapedHarness implements HarnessAdapter');
    expect(adapter).toContain('Detected run primitive: Workstream + AgentRun');
    expect(adapter).toContain('packages/db/prisma/schema.prisma:5 (Prisma model Workstream)');
    expect(adapter).toContain('Detected schedule primitive: Routine');
    expect(adapter).toContain(`env.CELUNE_API_URL ?? '${API}'`);

    const config = JSON.parse(result.files[1]!.content);
    expect(config).toMatchObject({
      version: 1,
      harness: 'headways-shaped',
      template: 'sdk-workstream',
      apiUrl: API,
      workspaceId: '<celune-workspace-id>',
      credentialEnv: 'CELUNE_API_KEY',
      adapter: 'celune/harness.ts',
      agents: { '<celune-agent-id>': '<harness-agent-id>' },
      detected: {
        shape: 'sdk-workstream',
        runPrimitive: { name: 'Workstream + AgentRun' },
        schedulePrimitive: { name: 'Routine', files: ['packages/db/prisma/schema.prisma:16'] },
        persistence: ['Prisma'],
      },
    });
    expect(result.files[2]!.content).toMatch(/^CELUNE_API_KEY=$/m);
  });

  it('uses the queue template for BullMQ and prints the skills path when Claude Code is absent', () => {
    const root = fixture('bullmq');
    const result = plan(root);
    expect(result.template).toBe('queue');
    expect(result.files.map((f) => f.path)).toEqual([
      'celune/harness.ts',
      '.celune/harness.json',
      '.env.celune.example',
    ]);
    expect(result.files[0]!.content).toContain('BullMQ wiring');
    expect(result.skillsSourceHint).toBe(bundledSkillsDir());
  });

  it('installs skills where --skills-dir points and skips them with --no-skills', () => {
    const root = fixture('bullmq');
    expect(plan(root, { skillsDir: 'agents/skills/' }).files.map((f) => f.path)).toContain(
      'agents/skills/celune-status/SKILL.md',
    );
    const none = plan(fixture('headways'), { skillsDir: null });
    expect(none.files.some((f) => f.path.includes('skills'))).toBe(false);
  });

  it('needs --template when nothing matched', () => {
    const root = fixture('no-match');
    expect(() => plan(root)).toThrow(NoTemplateError);
    const result = plan(root, { template: 'mcp', harnessName: 'plain' });
    expect(result.files[0]!.content).toContain(
      'export class PlainHarness implements HarnessAdapter',
    );
  });
});

describe('applyScaffold', () => {
  it('never overwrites an existing file without --force', () => {
    const root = fixture('headways');
    mkdirSync(join(root, 'celune'));
    writeFileSync(join(root, 'celune/harness.ts'), 'export const mine = true;\n');

    const first = plan(root);
    expect(first.files[0]!.action).toBe('skip');
    expect(formatPlan(first, true).join('\n')).toContain(
      '! celune/harness.ts  skip: exists and differs',
    );
    const written = applyScaffold(root, first);
    expect(written.map((f) => f.path)).not.toContain('celune/harness.ts');
    expect(readFileSync(join(root, 'celune/harness.ts'), 'utf8')).toBe(
      'export const mine = true;\n',
    );
    expect(existsSync(join(root, '.celune/harness.json'))).toBe(true);
    expect(readFileSync(join(root, '.claude/skills/celune-task/SKILL.md'), 'utf8')).toContain(
      'name: celune-task',
    );

    const second = plan(root);
    expect(countActions(second.files)).toEqual({ create: 0, overwrite: 0, skip: 1, unchanged: 5 });

    const forced = plan(root, { force: true });
    expect(forced.files[0]!.action).toBe('overwrite');
    applyScaffold(root, forced);
    expect(readFileSync(join(root, 'celune/harness.ts'), 'utf8')).toContain(
      'HeadwaysShapedHarness',
    );
  });
});

describe('symlinks in the target repo', () => {
  function outsideDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'celune-outside-'));
    dirs.push(dir);
    return dir;
  }

  it('refuses a directory symlink that points outside the repo', () => {
    const root = fixture('headways');
    const outside = outsideDir();
    symlinkSync(outside, join(root, 'celune'));
    expect(() => plan(root)).toThrow(/celune is a symlink/);
    expect(existsSync(join(outside, 'harness.ts'))).toBe(false);
  });

  it('refuses a directory symlink even when it stays inside the repo', () => {
    const root = fixture('headways');
    mkdirSync(join(root, 'real-dir'));
    symlinkSync(join(root, 'real-dir'), join(root, 'celune'));
    expect(() => plan(root)).toThrow(/celune is a symlink/);
  });

  it('refuses a dangling file symlink, with or without --force', () => {
    const root = fixture('headways');
    const outside = outsideDir();
    symlinkSync(join(outside, 'planted'), join(root, '.env.celune.example'));
    expect(() => plan(root)).toThrow(/is a symlink/);
    expect(() => plan(root, { force: true })).toThrow(/is a symlink/);
    expect(existsSync(join(outside, 'planted'))).toBe(false);
  });

  it('refuses .. paths and accepts plain paths', () => {
    const root = fixture('headways');
    expect(() => safeTarget(root, '../escape.ts')).toThrow(/outside the repository/);
    expect(safeTarget(root, 'celune/new/deep.ts')).toBe(join(root, 'celune/new/deep.ts'));
  });
});

describe('repo-derived text in generated code', () => {
  it('keeps evidence strings inside the header comment', () => {
    const root = fixture('headways');
    const report = detectHarness(root);
    const best = report.best!;
    const hostile = {
      ...best,
      runPrimitive: {
        name: 'run */ process.exit(1); /*',
        evidence: [{ file: 'a.ts', line: 1, note: 'x\n*/ process.exit(1);\r\u0000/*' }],
      },
    };
    const code = renderAdapter({
      harnessName: 'host',
      apiUrl: API,
      credentialEnv: 'CELUNE_API_KEY',
      template: best.template,
      report,
      match: hostile,
    });
    const header = code.slice(0, code.indexOf('\n */') + 4);
    expect(header.match(/\*\//g)).toHaveLength(1);
    expect(code).not.toMatch(/^\s*\*\/ process\.exit/m);
    expect(header).not.toMatch(/[\u0000\r]/);
  });

  it('rejects a --name that would break the generated source', () => {
    const root = fixture('headways');
    expect(() => plan(root, { harnessName: "x'; evil(); '" })).toThrow(/Harness name/);
  });
});

describe('bundled skills', () => {
  it('ship generic SKILL.md files that name only Celune MCP tools', () => {
    const tools = new Set([
      'add_comment',
      'block_task',
      'claim_task',
      'complete_task',
      'create_project',
      'create_task',
      'find_task_by_branch',
      'get_task',
      'list_available_agents',
      'list_projects',
      'list_tasks',
    ]);
    for (const skill of SKILL_NAMES) {
      const text = readFileSync(join(bundledSkillsDir(), skill, 'SKILL.md'), 'utf8');
      expect(text.startsWith(`---\nname: ${skill}\ndescription: `)).toBe(true);
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toContain('—');
      for (const [, tool] of text.matchAll(/`([a-z]+_[a-z_]+)`/g)) {
        if (
          tool!.includes('_') &&
          ![
            'branch_name',
            'task_id',
            'project_id',
            'project_type',
            'harness_run',
            'run_id',
            'action_state',
            'in_progress',
          ].includes(tool!)
        ) {
          expect(tools.has(tool!), `${skill} names ${tool}`).toBe(true);
        }
      }
    }
  });
});
