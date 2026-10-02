import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanRepository, type ScanResult, type ScannedFile } from './scan.js';

export type HarnessShape = 'sdk-workstream' | 'job-queue' | 'http-runner' | 'mcp-only';
export type TemplateId = 'sdk-workstream' | 'queue' | 'mcp';

export interface Evidence {
  file: string;
  line: number | null;
  note: string;
}

export interface Finding {
  name: string;
  evidence: Evidence[];
}

export interface HarnessMatch {
  shape: HarnessShape;
  label: string;
  template: TemplateId;
  /** 0 to 1. A match needs MIN_CONFIDENCE to be picked. */
  confidence: number;
  level: 'high' | 'medium' | 'low';
  runPrimitive: Finding | null;
  schedulePrimitive: Finding | null;
  evidence: Evidence[];
}

export interface DetectionReport {
  root: string;
  filesScanned: number;
  truncated: boolean;
  best: HarnessMatch | null;
  candidates: HarnessMatch[];
  persistence: Finding[];
  webFramework: Finding[];
  auth: Finding[];
  /** The repo already uses Claude Code or the Claude Agent SDK, so skills go to .claude/skills. */
  claudeCode: boolean;
}

export const MIN_CONFIDENCE = 0.45;
const SHAPE_RANK: Record<HarnessShape, number> = {
  'sdk-workstream': 0,
  'job-queue': 1,
  'http-runner': 2,
  'mcp-only': 3,
};
const EVIDENCE_LIMIT = 5;
const CODE = /\.(tsx?|mts|cts|[mc]?jsx?|py)$/;
const AUTH_PACKAGE = /(^|\/)([\w.-]+-)?auth(-[\w.-]+)?$/;
const TEST_FILE = /(__tests__|\.test\.|\.spec\.)/;
const AUTH_GUARD =
  /\b(requireAuth|requireUser|requireSession|requireActiveOrg|getServerSession|clerkMiddleware|authMiddleware|withAuth|jwtVerify|verifyToken|getAuth|currentUser)\s*\(/;

const RUN_MODEL = /^(AgentRun|Run|JobRun|TaskRun|WorkflowRun|Execution|AgentSession)$/;
const CONTAINER_MODEL = /^(Workstream|Mission|Workflow)$/;
const SCHEDULE_MODEL = /^(Routine|Schedule|ScheduledJob|ScheduledTask|CronJob|Automation)$/;

interface QueueSpec {
  id: string;
  label: string;
  dep: RegExp;
  imports: RegExp;
  run: RegExp;
  runName: string;
  schedule: RegExp;
  scheduleName: string;
}

const QUEUES: QueueSpec[] = [
  {
    id: 'bullmq',
    label: 'BullMQ',
    dep: /^bullmq$/,
    imports: /from\s+['"]bullmq['"]|require\(\s*['"]bullmq['"]\s*\)/,
    run: /\bnew\s+Worker\s*[<(]/,
    runName: 'BullMQ job (Worker processor)',
    schedule: /upsertJobScheduler\s*\(|\brepeat\s*:\s*\{/,
    scheduleName: 'BullMQ repeatable job',
  },
  {
    id: 'dbos',
    label: 'DBOS',
    dep: /^@dbos-inc\/dbos-sdk$|^dbos$/,
    imports: /['"]@dbos-inc\/dbos-sdk['"]|from\s+dbos\s+import|^import\s+dbos\b/m,
    run: /DBOS\.workflow\b|DBOS\.registerWorkflow\s*\(|DBOS\.startWorkflow\s*\(|new\s+WorkflowQueue\s*\(/,
    runName: 'DBOS workflow',
    schedule: /DBOS\.scheduled\b|registerScheduled\s*\(/,
    scheduleName: 'DBOS scheduled workflow',
  },
  {
    id: 'temporal',
    label: 'Temporal',
    dep: /^@temporalio\/(client|worker|workflow)$|^temporalio$/,
    imports: /['"]@temporalio\/|from\s+temporalio\b/,
    run: /proxyActivities\s*[<(]|workflow\.start\s*\(|Worker\.create\s*\(|@workflow\.defn/,
    runName: 'Temporal workflow',
    schedule: /schedule\.create\s*\(|create_schedule\s*\(/,
    scheduleName: 'Temporal schedule',
  },
  {
    id: 'inngest',
    label: 'Inngest',
    dep: /^inngest$/,
    imports: /from\s+['"]inngest(\/[^'"]*)?['"]/,
    run: /\.createFunction\s*\(/,
    runName: 'Inngest function',
    schedule: /\bcron\s*:\s*['"`]/,
    scheduleName: 'Inngest cron trigger',
  },
  {
    id: 'pg-boss',
    label: 'pg-boss',
    dep: /^pg-boss$/,
    imports: /from\s+['"]pg-boss['"]|require\(\s*['"]pg-boss['"]\s*\)/,
    run: /\.work\s*\(\s*['"`]/,
    runName: 'pg-boss job (work handler)',
    schedule: /\.schedule\s*\(\s*['"`]/,
    scheduleName: 'pg-boss schedule',
  },
];

interface Signals {
  scan: ScanResult;
  deps: Map<string, Evidence[]>;
  models: Map<string, Evidence>;
  apps: AppPackages;
}

/** Which workspace packages hold the auth guards and the code that uses the run models. */
interface AppPackages {
  packages: string[];
  guardDirs: Set<string>;
  modelDirs: Set<string>;
}

/** Scans `root` read-only and scores every known harness shape. */
export function detectHarness(root: string): DetectionReport {
  return analyze(scanRepository(root));
}

export function analyze(scan: ScanResult): DetectionReport {
  const models = collectModels(scan.files);
  const signals: Signals = {
    scan,
    deps: collectDeps(scan.files),
    models,
    apps: appPackages(scan.files, models),
  };
  const queues = QUEUES.map((spec) => scoreQueue(signals, spec)).sort((a, b) => b.score - a.score);

  const runtime = [
    detectSdkWorkstream(signals, queues),
    detectJobQueue(queues),
    detectHttpRunner(signals),
  ].filter((m): m is HarnessMatch => m !== null);
  const hasRuntime = runtime.some((m) => m.confidence >= MIN_CONFIDENCE);
  const mcp = detectMcpOnly(signals, hasRuntime);
  // On equal confidence the more specific shape wins: an SDK host's queue is its dispatcher.
  const candidates = [...runtime, ...(mcp ? [mcp] : [])].sort(
    (a, b) => b.confidence - a.confidence || SHAPE_RANK[a.shape] - SHAPE_RANK[b.shape],
  );
  const best = candidates[0] && candidates[0].confidence >= MIN_CONFIDENCE ? candidates[0] : null;

  const sdkUsed = [...signals.deps.keys()].some((d) => /claude-agent-sdk/.test(d));
  const claudeCode =
    sdkUsed ||
    existsSync(join(scan.root, '.claude')) ||
    scan.paths.some((p) => /^\.claude\/|^\.mcp\.json$|^CLAUDE\.md$/.test(p));

  return {
    root: scan.root,
    filesScanned: scan.files.length,
    truncated: scan.truncated,
    best,
    candidates,
    persistence: detectPersistence(signals),
    webFramework: detectWebFramework(signals),
    auth: detectAuth(signals),
    claudeCode,
  };
}

// ---------------------------------------------------------------------------
// Detectors

function detectSdkWorkstream(s: Signals, queues: QueueScore[]): HarnessMatch | null {
  const sdkDep = depEvidence(s, /^@anthropic-ai\/claude-agent-sdk$|^claude-agent-sdk$/);
  const sdkImportFiles = s.scan.files.filter(
    (f) =>
      CODE.test(f.path) &&
      /['"]@anthropic-ai\/claude-agent-sdk['"]|from\s+claude_agent_sdk\s+import|^import\s+claude_agent_sdk/m.test(
        f.content,
      ),
  );
  if (sdkDep.length === 0 && sdkImportFiles.length === 0) return null;

  const sdkImports = grep(
    sdkImportFiles,
    /claude-agent-sdk|claude_agent_sdk/,
    'imports the Claude Agent SDK',
  );
  const sdkCalls = grep(
    sdkImportFiles,
    /\bClaudeSDKClient\b|\bquery\s*\(/,
    'starts an SDK session',
  );
  const run = firstModel(s, RUN_MODEL);
  const container = firstModel(s, CONTAINER_MODEL);
  const schedule = firstModel(s, SCHEDULE_MODEL);
  const dispatcher = queues.find((q) => q.score >= 3) ?? null;
  const prisma = [...s.models.values()].length > 0;

  const score =
    3 +
    (sdkCalls.length ? 2 : 0) +
    (run ? 2 : 0) +
    (container ? 1.5 : 0) +
    (dispatcher ? 1 : 0) +
    (schedule ? 1 : 0) +
    (prisma ? 0.5 : 0);

  let runPrimitive: Finding;
  if (container && run) {
    runPrimitive = {
      name: `${container.name} + ${run.name}`,
      evidence: [container.evidence, run.evidence],
    };
  } else if (run) {
    runPrimitive = { name: run.name, evidence: [run.evidence] };
  } else {
    runPrimitive = {
      name: 'Claude Agent SDK session (query)',
      evidence: sdkCalls.length ? sdkCalls : sdkImports,
    };
  }
  let schedulePrimitive: Finding | null = null;
  if (schedule) schedulePrimitive = { name: schedule.name, evidence: [schedule.evidence] };
  else if (dispatcher?.schedule.length) {
    schedulePrimitive = { name: dispatcher.spec.scheduleName, evidence: dispatcher.schedule };
  }

  const evidence = [
    ...sdkDep.slice(0, 1),
    ...sdkImports.slice(0, 2),
    ...sdkCalls.slice(0, 2),
    ...(dispatcher
      ? [
          ...(dispatcher.run[0] ? [dispatcher.run[0]] : dispatcher.dep.slice(0, 1)).map((e) => ({
            ...e,
            note: `${dispatcher.spec.label} dispatcher: ${e.note}`,
          })),
        ]
      : []),
  ];
  return match('sdk-workstream', 'Claude Agent SDK host', 'sdk-workstream', score / 9, {
    runPrimitive,
    schedulePrimitive,
    evidence,
  });
}

function detectJobQueue(queues: QueueScore[]): HarnessMatch | null {
  const top = queues[0];
  if (!top || top.score === 0) return null;
  return match('job-queue', `Job queue (${top.spec.label})`, 'queue', top.score / 6, {
    runPrimitive: {
      name: top.spec.runName,
      evidence: top.run.length ? top.run : [...top.imports, ...top.dep].slice(0, EVIDENCE_LIMIT),
    },
    schedulePrimitive: top.schedule.length
      ? { name: top.spec.scheduleName, evidence: top.schedule }
      : null,
    evidence: [...top.dep.slice(0, 1), ...top.imports.slice(0, 2), ...top.run.slice(0, 2)],
  });
}

function detectHttpRunner(s: Signals): HarnessMatch | null {
  const routes: Evidence[] = [];
  const routeCall =
    /\b(?:app|router|server|api|routes?)\.(post|put)\s*\(\s*['"`]([^'"`]*\b(?:tasks?|jobs?|runs?)\b[^'"`]*)['"`]/i;
  const decorator =
    /@(?:app|router)\.(post|put)\(\s*['"]([^'"]*\b(?:tasks?|jobs?|runs?)\b[^'"]*)['"]/i;
  for (const f of s.scan.files) {
    if (!CODE.test(f.path)) continue;
    const nextRoute = /(^|\/)app\/api\/(.+\/)?(tasks|jobs|runs)\/(.+\/)?route\.[jt]s$/.exec(f.path);
    if (nextRoute && /export\s+(async\s+)?function\s+POST|export\s+const\s+POST/.test(f.content)) {
      routes.push({
        file: f.path,
        line: lineOf(f.content, /POST/),
        note: `POST ${routePathOf(f.path)}`,
      });
      continue;
    }
    const m = routeCall.exec(f.content) ?? decorator.exec(f.content);
    if (m) {
      routes.push({
        file: f.path,
        line: lineOf(f.content, m[0]),
        note: `${m[1]!.toUpperCase()} ${m[2]}`,
      });
    }
  }
  if (routes.length === 0) return null;
  const cron = [
    ...depEvidence(s, /^(node-cron|croner|node-schedule)$/),
    ...grep(
      s.scan.files.filter((f) => CODE.test(f.path)),
      /\bcron\.schedule\s*\(|new\s+Cron\s*\(/,
      'cron schedule',
    ),
  ];
  const framework = detectWebFramework(s).length > 0;
  const score = 3 + (framework ? 1 : 0) + (cron.length ? 1 : 0);
  return match('http-runner', 'HTTP task runner', 'queue', score / 5, {
    runPrimitive: {
      name: `HTTP task endpoint (${routes[0]!.note})`,
      evidence: routes.slice(0, EVIDENCE_LIMIT),
    },
    schedulePrimitive: cron.length
      ? { name: 'Cron schedule', evidence: cron.slice(0, EVIDENCE_LIMIT) }
      : null,
    evidence: routes.slice(0, 3),
  });
}

function detectMcpOnly(s: Signals, hasRuntime: boolean): HarnessMatch | null {
  const paths = s.scan.paths;
  const mcpJson = paths.filter((p) => /(^|\/)\.mcp\.json$/.test(p));
  const cursor = paths.filter((p) => /(^|\/)\.cursor\/mcp\.json$/.test(p));
  const claudeDir =
    existsSync(join(s.scan.root, '.claude')) || paths.some((p) => p.startsWith('.claude/'));
  const guide = paths.filter((p) => /^(CLAUDE|AGENTS)\.md$/.test(p));
  if (mcpJson.length === 0 && cursor.length === 0 && !claudeDir && guide.length === 0) return null;

  let score = 0;
  if (mcpJson.length || cursor.length) score += 3;
  if (mcpJson.length && cursor.length) score += 1;
  if (claudeDir) score += 1;
  if (guide.length) score += 1;
  // A repo with its own agent runtime is not MCP-only, even when it has an .mcp.json.
  if (hasRuntime) score *= 0.5;

  const evidence: Evidence[] = [
    ...mcpJson.map((file) => ({ file, line: null, note: 'Claude Code MCP config' })),
    ...cursor.map((file) => ({ file, line: null, note: 'Cursor MCP config' })),
    ...(claudeDir ? [{ file: '.claude/', line: null, note: 'Claude Code project settings' }] : []),
    ...guide.map((file) => ({ file, line: null, note: 'agent instructions file' })),
  ].slice(0, EVIDENCE_LIMIT);
  return match('mcp-only', 'MCP-only agent (Claude Code or Cursor)', 'mcp', score / 4, {
    runPrimitive: { name: 'Coding agent session using the Celune MCP tools', evidence },
    schedulePrimitive: null,
    evidence,
  });
}

function detectPersistence(s: Signals): Finding[] {
  const out: Finding[] = [];
  const schemaFiles = s.scan.files
    .filter((f) => f.path.endsWith('.prisma'))
    .map((f) => ({ file: f.path, line: null, note: 'Prisma schema' }));
  const prisma = [...depEvidence(s, /^(@prisma\/client|prisma)$/), ...schemaFiles];
  if (prisma.length) out.push({ name: 'Prisma', evidence: prisma.slice(0, EVIDENCE_LIMIT) });
  const table: Array<[string, RegExp]> = [
    ['Drizzle', /^drizzle-orm$/],
    ['TypeORM', /^typeorm$/],
    ['Kysely', /^kysely$/],
    ['Knex', /^knex$/],
    ['Mongoose', /^mongoose$/],
    ['Supabase', /^@supabase\/supabase-js$|^supabase$/],
    ['SQLAlchemy', /^sqlalchemy$/i],
    ['Django ORM', /^django$/i],
  ];
  for (const [name, re] of table) {
    const ev = depEvidence(s, re);
    if (ev.length) out.push({ name, evidence: ev.slice(0, EVIDENCE_LIMIT) });
  }
  return out;
}

function detectWebFramework(s: Signals): Finding[] {
  const code = s.scan.files.filter((f) => CODE.test(f.path));
  const table: Array<{ name: string; dep: RegExp; entry?: RegExp; content?: RegExp }> = [
    {
      name: 'Next.js',
      dep: /^next$/,
      entry: /(^|\/)(app\/layout|pages\/_app|middleware)\.[jt]sx?$/,
    },
    {
      name: 'React Router',
      dep: /^(@react-router\/[a-z-]+|react-router)$/,
      entry: /(^|\/)app\/(routes|root)\.[jt]sx?$/,
    },
    {
      name: 'Remix',
      dep: /^@remix-run\/(node|react|server-runtime)$/,
      entry: /(^|\/)app\/root\.[jt]sx?$/,
    },
    { name: 'Hono', dep: /^hono$/, content: /\bnew\s+Hono\s*[<(]/ },
    { name: 'Express', dep: /^express$/, content: /\bexpress\(\s*\)/ },
    { name: 'Fastify', dep: /^fastify$/, content: /\b[Ff]astify\s*\(\s*\{?/ },
    { name: 'NestJS', dep: /^@nestjs\/core$/, content: /NestFactory\.create\s*\(/ },
    { name: 'FastAPI', dep: /^fastapi$/i, content: /\bFastAPI\s*\(/ },
    { name: 'Django', dep: /^django$/i },
    { name: 'Flask', dep: /^flask$/i, content: /\bFlask\s*\(\s*__name__/ },
  ];
  // In a monorepo the docs site and the product app can use different frameworks. The one
  // that matters is the app whose package holds the auth guards and uses the run models.
  const { packages } = s.apps;
  const ranked: Array<{ finding: Finding; score: number }> = [];
  for (const row of table) {
    const dep = depEvidence(s, row.dep);
    if (!dep.length) continue;
    const entryPaths = row.entry ? s.scan.paths.filter((p) => row.entry!.test(p)) : [];
    const contentEntries = row.content ? grep(code, row.content, 'app entry point') : [];
    const best = bestPackage(s.apps, dep, (dir) => {
      const inDir = (file: string) => ownerOf(packages, file) === dir;
      return entryPaths.some(inDir) || contentEntries.some((e) => inDir(e.file)) ? 0.5 : 0;
    });
    const inBest = (file: string) => ownerOf(packages, file) === best.dir;
    const entries: Evidence[] = [
      ...entryPaths.filter(inBest),
      ...entryPaths.filter((p) => !inBest(p)),
    ]
      .slice(0, 3)
      .map((p) => ({ file: p, line: null, note: 'entry point' }));
    entries.push(
      ...[
        ...contentEntries.filter((e) => inBest(e.file)),
        ...contentEntries.filter((e) => !inBest(e.file)),
      ].slice(0, 3),
    );
    ranked.push({
      finding: {
        name: row.name,
        evidence: [...orderedDeps(dep, best).slice(0, 1), ...entries].slice(0, EVIDENCE_LIMIT),
      },
      score: best.score,
    });
  }
  // Array.prototype.sort is stable, so equal scores keep the table order.
  return ranked.sort((a, b) => b.score - a.score).map((r) => r.finding);
}

function detectAuth(s: Signals): Finding[] {
  const table: Array<[string, RegExp]> = [
    ['Clerk', /^@clerk\//],
    ['Auth.js (NextAuth)', /^(next-auth|@auth\/core)$/],
    ['Better Auth', /^better-auth$/],
    ['Supabase Auth', /^@supabase\/(ssr|auth-helpers-nextjs|auth-js)$/],
    ['Lucia', /^lucia$/],
    ['Passport', /^passport$/],
    ['WorkOS', /^@workos-inc\//],
    ['Firebase Auth', /^firebase-admin$/],
    ['JWT (jose or jsonwebtoken)', /^(jose|jsonwebtoken|pyjwt)$/i],
  ];
  // Rank providers the same way as web frameworks: the product app's provider first, then
  // the shared auth package's, ahead of one that only a docs or marketing site declares.
  const ranked: Array<{ finding: Finding; score: number }> = [];
  for (const [name, re] of table) {
    const dep = depEvidence(s, re);
    if (!dep.length) continue;
    const best = bestPackage(s.apps, dep, (dir) => (AUTH_PACKAGE.test(dir) ? 1 : 0));
    ranked.push({
      finding: { name, evidence: orderedDeps(dep, best).slice(0, 2) },
      score: best.score,
    });
  }
  const out = ranked.sort((a, b) => b.score - a.score).map((r) => r.finding);
  const guards = grep(
    s.scan.files.filter((f) => CODE.test(f.path) && !TEST_FILE.test(f.path)),
    AUTH_GUARD,
    'auth guard',
  );
  if (guards.length) out.push({ name: 'Auth entry points', evidence: guards });
  return out;
}

// ---------------------------------------------------------------------------
// Signal helpers

interface QueueScore {
  spec: QueueSpec;
  score: number;
  dep: Evidence[];
  imports: Evidence[];
  run: Evidence[];
  schedule: Evidence[];
}

function scoreQueue(s: Signals, spec: QueueSpec): QueueScore {
  const dep = depEvidence(s, spec.dep);
  const importing = s.scan.files.filter((f) => CODE.test(f.path) && spec.imports.test(f.content));
  const imports = grep(importing, spec.imports, `imports ${spec.label}`);
  const run = grep(importing, spec.run, spec.runName);
  const schedule = grep(importing, spec.schedule, spec.scheduleName);
  const score =
    (dep.length ? 3 : 0) +
    (imports.length ? 1 : 0) +
    (run.length ? 2 : 0) +
    (schedule.length ? 1 : 0);
  return { spec, score, dep, imports, run, schedule };
}

function collectDeps(files: ScannedFile[]): Map<string, Evidence[]> {
  const deps = new Map<string, Evidence[]>();
  const add = (name: string, ev: Evidence) => {
    const list = deps.get(name) ?? [];
    if (list.length < EVIDENCE_LIMIT) list.push(ev);
    deps.set(name, list);
  };
  for (const f of files) {
    if (/(^|\/)package\.json$/.test(f.path)) {
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(f.content) as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ]) {
        const block = pkg[field];
        if (!block || typeof block !== 'object') continue;
        for (const name of Object.keys(block)) {
          add(name, {
            file: f.path,
            line: lineOf(f.content, `"${name}"`),
            note: `depends on ${name}`,
          });
        }
      }
    } else if (/(^|\/)(requirements[^/]*\.txt|pyproject\.toml)$/.test(f.path)) {
      // requirements: one package per line. pyproject: quoted entries in dependency arrays.
      const entry = f.path.endsWith('.toml') ? /^\s*"([A-Za-z0-9_.-]+)/ : /^([A-Za-z0-9_.-]+)/;
      f.content.split('\n').forEach((raw, i) => {
        const m = entry.exec(raw);
        if (m) add(m[1]!.toLowerCase(), { file: f.path, line: i + 1, note: `depends on ${m[1]}` });
      });
    }
  }
  return deps;
}

function collectModels(files: ScannedFile[]): Map<string, Evidence> {
  const models = new Map<string, Evidence>();
  for (const f of files) {
    if (!f.path.endsWith('.prisma')) continue;
    f.content.split('\n').forEach((raw, i) => {
      const m = /^\s*model\s+(\w+)\s*\{/.exec(raw);
      if (m && !models.has(m[1]!)) {
        models.set(m[1]!, { file: f.path, line: i + 1, note: `Prisma model ${m[1]}` });
      }
    });
  }
  return models;
}

function firstModel(s: Signals, re: RegExp): { name: string; evidence: Evidence } | null {
  for (const [name, evidence] of s.models) if (re.test(name)) return { name, evidence };
  return null;
}

function appPackages(files: ScannedFile[], models: Map<string, Evidence>): AppPackages {
  const code = files.filter((f) => CODE.test(f.path));
  const packages = packageDirs(files);
  const guardDirs = ownerDirs(
    packages,
    code.filter((f) => AUTH_GUARD.test(f.content)),
  );
  const modelNames = [...models.keys()].filter((n) => RUN_MODEL.test(n) || CONTAINER_MODEL.test(n));
  // Model names come from `model (\w+)` in a Prisma schema, so they are safe in a RegExp.
  const modelRef = modelNames.length
    ? new RegExp(`\\b(${modelNames.flatMap((n) => [n, lowerFirst(n)]).join('|')})\\b`)
    : null;
  const modelDirs = modelRef
    ? ownerDirs(
        packages,
        code.filter((f) => modelRef.test(f.content)),
      )
    : new Set<string>();
  return { packages, guardDirs, modelDirs };
}

interface PackageScore {
  score: number;
  dir: string;
  notes: string[];
}

/** Scores each package that declares a dependency and returns the best one. */
function bestPackage(
  apps: AppPackages,
  dep: Evidence[],
  bonus: (dir: string) => number,
): PackageScore {
  let best: PackageScore = { score: -1, dir: '', notes: [] };
  for (const ev of dep) {
    const dir = dirOf(ev.file);
    const notes: string[] = [];
    let score = bonus(dir);
    if (apps.guardDirs.has(dir)) {
      score += 2;
      notes.push('auth guards');
    }
    if (apps.modelDirs.has(dir)) {
      score += 2;
      notes.push('run models');
    }
    if (score > best.score) best = { score, dir, notes };
  }
  return best;
}

/** Puts the best package's declaration first and says why it ranked. */
function orderedDeps(dep: Evidence[], best: PackageScore): Evidence[] {
  const first = dep.find((e) => dirOf(e.file) === best.dir) ?? dep[0]!;
  const noted = best.notes.length
    ? { ...first, note: `${first.note}; this package holds the ${best.notes.join(' and ')}` }
    : first;
  return [noted, ...dep.filter((e) => e !== first)];
}

const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt)$/;

/** Directories that hold a package manifest, deepest first. The repo root is ''. */
function packageDirs(files: ScannedFile[]): string[] {
  const dirs = new Set(files.filter((f) => MANIFEST.test(f.path)).map((f) => dirOf(f.path)));
  dirs.add('');
  return [...dirs].sort((a, b) => b.length - a.length);
}

function ownerOf(packages: string[], file: string): string {
  return packages.find((dir) => dir === '' || file.startsWith(`${dir}/`)) ?? '';
}

function ownerDirs(packages: string[], files: ScannedFile[]): Set<string> {
  return new Set(
    files.filter((f) => !TEST_FILE.test(f.path)).map((f) => ownerOf(packages, f.path)),
  );
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function depEvidence(s: Signals, re: RegExp): Evidence[] {
  const out: Evidence[] = [];
  for (const [name, ev] of s.deps) if (re.test(name)) out.push(...ev);
  return out.slice(0, EVIDENCE_LIMIT);
}

function grep(files: ScannedFile[], re: RegExp, note: string): Evidence[] {
  const out: Evidence[] = [];
  for (const f of files) {
    const m = re.exec(f.content);
    if (!m) continue;
    out.push({ file: f.path, line: lineOf(f.content, m[0]), note });
    if (out.length >= EVIDENCE_LIMIT) break;
  }
  return out;
}

function lineOf(content: string, needle: string | RegExp): number | null {
  const index = typeof needle === 'string' ? content.indexOf(needle) : content.search(needle);
  if (index < 0) return null;
  return content.slice(0, index).split('\n').length;
}

function routePathOf(path: string): string {
  const m = /app(\/api\/.+)\/route\.[jt]s$/.exec(path);
  return m ? m[1]!.replace(/\([^)]*\)\//g, '') : path;
}

function match(
  shape: HarnessShape,
  label: string,
  template: TemplateId,
  raw: number,
  rest: Pick<HarnessMatch, 'runPrimitive' | 'schedulePrimitive' | 'evidence'>,
): HarnessMatch {
  const confidence = Math.round(Math.min(1, raw) * 100) / 100;
  const level = confidence >= 0.75 ? 'high' : confidence >= MIN_CONFIDENCE ? 'medium' : 'low';
  return { shape, label, template, confidence, level, ...rest };
}
