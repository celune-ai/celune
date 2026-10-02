import { resolve } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config-store.js';
import { DEFAULT_API_URL } from '../defaults.js';
import { cliCommand } from '../invocation.js';
import {
  isSafeApiUrl,
  loadHarnessConfig,
  runHarnessCheck,
  storedKeyAllowed,
  type CheckResult,
} from '../connect/check.js';
import {
  detectHarness,
  type DetectionReport,
  type Evidence,
  type Finding,
  type TemplateId,
} from '../connect/detect.js';
import {
  applyScaffold,
  formatPlan,
  NoTemplateError,
  planScaffold,
  type ScaffoldPlan,
} from '../connect/scaffold.js';
import { TEMPLATE_IDS } from '../connect/templates.js';

interface ConnectOptions {
  write?: boolean;
  force?: boolean;
  check?: boolean;
  json?: boolean;
  template?: string;
  name?: string;
  apiUrl?: string;
  workspace?: string;
  outDir?: string;
  skillsDir?: string;
  skills?: boolean;
}

export function registerConnectCommand(program: Command): void {
  program
    .command('connect [dir]')
    .description(
      'Detect the agent harness in a repository, scaffold a Celune adapter, and install skills',
    )
    .option('--write', 'Write the planned files (default is a dry run)')
    .option('--force', 'Overwrite files that already exist')
    .option('--check', 'Post a test event to /v1/harness/events with the configured credential')
    .option('--json', 'Print the detection report as JSON')
    .option('--template <id>', `Adapter template: ${TEMPLATE_IDS.join(', ')}`)
    .option('--name <harness>', 'Harness name (default: from package.json or the directory)')
    .option('--api-url <url>', 'Celune API origin written to .celune/harness.json')
    .option('--workspace <id>', 'Celune workspace id written to .celune/harness.json')
    .option('--out-dir <dir>', 'Directory for the adapter file', 'celune')
    .option(
      '--skills-dir <dir>',
      'Install the Celune skills here (default: .claude/skills when Claude Code is used)',
    )
    .option('--no-skills', 'Do not install the Celune skills')
    .action(async (dir: string | undefined, opts: ConnectOptions) => {
      const root = resolve(dir ?? process.cwd());
      const code = opts.check ? await checkCommand(root, opts) : scaffoldCommand(root, opts);
      process.exitCode = code;
    });
}

function scaffoldCommand(root: string, opts: ConnectOptions): number {
  if (opts.template && !TEMPLATE_IDS.includes(opts.template as TemplateId)) {
    console.error(
      chalk.red(`Unknown template "${opts.template}". Use ${TEMPLATE_IDS.join(', ')}.`),
    );
    return 1;
  }
  const report = detectHarness(root);
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  for (const line of formatReport(report)) console.log(line);

  let plan: ScaffoldPlan;
  try {
    plan = planScaffold({
      root,
      report,
      template: opts.template as TemplateId | undefined,
      harnessName: opts.name,
      apiUrl: (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, ''),
      workspaceId: opts.workspace ?? loadConfig()?.workspaceId ?? undefined,
      outDir: opts.outDir,
      skillsDir: opts.skills === false ? null : opts.skillsDir,
      force: opts.force,
    });
  } catch (error) {
    if (error instanceof NoTemplateError) {
      console.log(chalk.yellow(error.message));
      return opts.write ? 1 : 0;
    }
    throw error;
  }

  console.log();
  console.log(chalk.bold(`Scaffold (${plan.template} template, harness "${plan.harnessName}")`));
  for (const line of formatPlan(plan, Boolean(opts.write))) console.log(line);

  if (plan.skillsSourceHint && opts.skills !== false) {
    console.log();
    console.log(
      chalk.dim('Skills not installed: no Claude Code signals in this repo. Copy them from'),
      plan.skillsSourceHint,
      chalk.dim("into your harness's skills directory, or pass --skills-dir <dir>."),
    );
  }

  if (!opts.write) return 0;
  const written = applyScaffold(root, plan);
  const CLI = cliCommand();
  console.log();
  console.log(chalk.green(`Wrote ${written.length} file${written.length === 1 ? '' : 's'}.`));
  console.log(
    chalk.dim('Next: fill in the adapter TODOs, map agents in .celune/harness.json, set the'),
  );
  console.log(
    chalk.dim('credential variable from .env.celune.example, then run'),
    chalk.cyan(`${CLI} connect --check`),
  );
  return 0;
}

async function checkCommand(root: string, opts: ConnectOptions): Promise<number> {
  let config;
  try {
    config = loadHarnessConfig(root);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    return 1;
  }
  const apiUrl = opts.apiUrl ?? config.apiUrl;
  if (!isSafeApiUrl(apiUrl)) {
    console.error(
      chalk.red(`Refusing to send a credential to ${apiUrl}. Use https (http only for localhost).`),
    );
    return 1;
  }
  const envName = config.credentialEnv ?? 'CELUNE_API_KEY';
  const fromEnv = process.env[envName];
  const saved = fromEnv ? null : loadConfig();
  const stored =
    saved && storedKeyAllowed(apiUrl, [DEFAULT_API_URL, saved.mcpEndpoint])
      ? saved.apiKey
      : undefined;
  const credential = fromEnv ?? stored;
  if (!credential) {
    const why = saved
      ? ` The key saved by celune setup is only sent to its own Celune origin, and ${apiUrl} is a different one.`
      : '';
    console.error(chalk.red(`No credential. Set ${envName} to an API key with write scope.${why}`));
    return 1;
  }
  console.log(chalk.dim(`Target: ${new URL(apiUrl).origin}`));
  console.log(chalk.dim(`Credential: ${fromEnv ? envName : 'the key saved by celune setup'}`));
  const result = await runHarnessCheck({
    apiUrl,
    harness: config.harness,
    credential,
  });
  printCheck(result);
  return result.ok ? 0 : 1;
}

function printCheck(result: CheckResult): void {
  const mark = result.ok ? chalk.green('✓') : chalk.red('✗');
  console.log(
    mark,
    `POST ${result.url}`,
    chalk.dim(result.status === null ? '(no response)' : `(${result.status})`),
  );
  console.log(' ', result.message);
}

export function formatReport(report: DetectionReport): string[] {
  const lines = [
    chalk.bold('Harness detection'),
    chalk.dim(
      `  ${report.root} (${report.filesScanned} files scanned${report.truncated ? ', truncated' : ''})`,
    ),
    '',
  ];
  const best = report.best;
  if (!best) {
    lines.push(chalk.yellow('  No known harness shape matched.'));
  } else {
    lines.push(
      `  Shape:       ${best.label} ${chalk.dim(`(${best.level} confidence, ${best.confidence.toFixed(2)})`)}`,
    );
  }
  const finding = (label: string, f: Finding | null | undefined) => {
    lines.push(`  ${label.padEnd(12)} ${f ? f.name : chalk.dim('none found')}`);
    if (f)
      for (const e of f.evidence.slice(0, 3))
        lines.push(chalk.dim(`               ${ref(e)}  ${e.note}`));
  };
  const list = (label: string, findings: Finding[]) => {
    if (findings.length === 0) {
      lines.push(`  ${label.padEnd(12)} ${chalk.dim('none found')}`);
      return;
    }
    findings.forEach((f, i) => {
      lines.push(`  ${(i === 0 ? label : '').padEnd(12)} ${f.name}`);
      for (const e of f.evidence.slice(0, 2))
        lines.push(chalk.dim(`               ${ref(e)}  ${e.note}`));
    });
  };
  if (best) {
    finding('Run:', best.runPrimitive);
    finding('Schedule:', best.schedulePrimitive);
  }
  list('Persistence:', report.persistence);
  list('Web:', report.webFramework);
  list('Auth:', report.auth);
  const others = report.candidates.filter((c) => c !== best);
  if (others.length) {
    lines.push('', chalk.dim('  Other candidates:'));
    for (const c of others)
      lines.push(chalk.dim(`    ${c.label} (${c.level}, ${c.confidence.toFixed(2)})`));
  }
  return lines;
}

function ref(e: Evidence): string {
  return e.line ? `${e.file}:${e.line}` : e.file;
}
