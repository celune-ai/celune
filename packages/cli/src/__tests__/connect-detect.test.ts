import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectHarness, MIN_CONFIDENCE, type Finding } from '../connect/detect.js';
import { copyFixture } from './connect-fixtures.js';

const dirs: string[] = [];
function fixture(name: string): string {
  const dir = copyFixture(name);
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const names = (findings: Finding[]) => findings.map((f) => f.name);
const refs = (finding: Finding | null | undefined) =>
  (finding?.evidence ?? []).map((e) => (e.line ? `${e.file}:${e.line}` : e.file));

describe('detectHarness', () => {
  it('reads a Headways-shaped repo as an SDK host with Workstreams and Routines', () => {
    const report = detectHarness(fixture('headways'));
    const best = report.best!;
    expect(best.shape).toBe('sdk-workstream');
    expect(best.template).toBe('sdk-workstream');
    expect(best.level).toBe('high');
    expect(best.runPrimitive?.name).toBe('Workstream + AgentRun');
    expect(refs(best.runPrimitive)).toEqual([
      'packages/db/prisma/schema.prisma:5',
      'packages/db/prisma/schema.prisma:10',
    ]);
    expect(best.schedulePrimitive?.name).toBe('Routine');
    expect(refs(best.schedulePrimitive)).toEqual(['packages/db/prisma/schema.prisma:16']);
    expect(best.evidence.map((e) => e.note)).toEqual(
      expect.arrayContaining(['starts an SDK session', 'DBOS dispatcher: DBOS workflow']),
    );

    expect(names(report.persistence)).toEqual(['Prisma']);
    // apps/api holds the only auth guard, so its framework ranks first.
    expect(names(report.webFramework)).toEqual(['Hono', 'React Router']);
    expect(names(report.auth)).toEqual(['JWT (jose or jsonwebtoken)', 'Auth entry points']);
    expect(refs(report.auth[1])).toEqual(['apps/api/src/server.ts:7']);
    expect(report.claudeCode).toBe(true);

    // The DBOS dispatcher and the .mcp.json are candidates, ranked below the SDK host.
    const queue = report.candidates.find((c) => c.shape === 'job-queue');
    expect(queue?.label).toBe('Job queue (DBOS)');
    const mcp = report.candidates.find((c) => c.shape === 'mcp-only');
    expect(mcp!.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('ranks web frameworks and auth providers by the app that holds the auth guard and the run models', () => {
    // Mirrors Headways: a Next.js docs site, the product app on React Router with the auth
    // guard and loaders that read AgentRun, and a Hono API with a JWT check only.
    const report = detectHarness(fixture('headways-web'));
    expect(names(report.webFramework)).toEqual(['React Router', 'Hono', 'Next.js']);
    const [web] = report.webFramework;
    expect(refs(web)).toEqual(['apps/web/package.json:5', 'apps/web/app/root.tsx']);
    expect(web!.evidence[0]!.note).toBe(
      'depends on @react-router/node; this package holds the auth guards and run models',
    );
    expect(refs(report.webFramework[2])).toEqual([
      'apps/docs/package.json:4',
      'apps/docs/app/layout.tsx',
    ]);

    // Better Auth backs the guards in apps/web and packages/auth; Auth.js is only a
    // dependency of the docs app, so it ranks below both.
    expect(names(report.auth)).toEqual([
      'Better Auth',
      'JWT (jose or jsonwebtoken)',
      'Auth.js (NextAuth)',
      'Auth entry points',
    ]);
    expect(refs(report.auth[0])).toEqual([
      'apps/web/package.json:7',
      'packages/auth/package.json:4',
    ]);
    expect(report.auth[0]!.evidence[0]!.note).toBe(
      'depends on better-auth; this package holds the auth guards and run models',
    );
  });

  it('reads a BullMQ repo as a job queue with a repeatable-job schedule', () => {
    const report = detectHarness(fixture('bullmq'));
    const best = report.best!;
    expect(best.shape).toBe('job-queue');
    expect(best.label).toBe('Job queue (BullMQ)');
    expect(best.template).toBe('queue');
    expect(best.runPrimitive?.name).toBe('BullMQ job (Worker processor)');
    expect(refs(best.runPrimitive)).toEqual(['src/worker.ts:3']);
    expect(best.schedulePrimitive?.name).toBe('BullMQ repeatable job');
    expect(refs(best.schedulePrimitive)).toEqual(['src/schedule.ts:4']);
    expect(names(report.persistence)).toEqual(['Drizzle']);
    expect(names(report.webFramework)).toEqual(['Express']);
    expect(report.claudeCode).toBe(false);
    // The POST /jobs route also makes it an HTTP runner candidate, ranked lower.
    expect(report.candidates.map((c) => c.shape)).toEqual(['job-queue', 'http-runner']);
  });

  it('reads a repo with only MCP config as MCP-only', () => {
    const report = detectHarness(fixture('mcp-only'));
    expect(report.best?.shape).toBe('mcp-only');
    expect(report.best?.template).toBe('mcp');
    expect(report.best?.level).toBe('high');
    expect(report.best?.schedulePrimitive).toBeNull();
    expect(refs(report.best?.runPrimitive)).toEqual(['.mcp.json', '.claude/', 'CLAUDE.md']);
    expect(report.claudeCode).toBe(true);
  });

  it('matches nothing in a plain library', () => {
    const report = detectHarness(fixture('no-match'));
    expect(report.best).toBeNull();
    expect(report.candidates).toEqual([]);
    expect(report.persistence).toEqual([]);
    expect(report.claudeCode).toBe(false);
  });

  it('skips node_modules, build output, and .gitignore paths without git', () => {
    const dir = fixture('no-match');
    const worker = "import { Worker } from 'bullmq';\nnew Worker('q', async () => 1);\n";
    for (const sub of ['node_modules/bullmq', 'dist', 'build', 'generated']) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, 'worker.ts'), worker);
      writeFileSync(join(dir, sub, 'package.json'), '{"dependencies":{"bullmq":"5"}}');
    }
    writeFileSync(join(dir, '.gitignore'), 'generated/\n');
    const report = detectHarness(dir);
    expect(report.best).toBeNull();
    expect(report.candidates).toEqual([]);
  });

  it('uses git to respect .gitignore inside a work tree', () => {
    const dir = fixture('no-match');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(join(dir, 'scratch'));
    writeFileSync(join(dir, 'scratch', 'package.json'), '{"dependencies":{"bullmq":"5"}}');
    writeFileSync(join(dir, '.gitignore'), '/scratch\n');
    expect(detectHarness(dir).best).toBeNull();

    writeFileSync(join(dir, '.gitignore'), '');
    expect(detectHarness(dir).candidates.map((c) => c.shape)).toEqual(['job-queue']);
  });
});
