import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile } from 'node:fs/promises';
import { loadConfig } from '../config-store.js';
import { DEFAULT_API_URL } from '../defaults.js';

const GZIP_MAGIC = [0x1f, 0x8b];

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('Not connected.'));
    console.log(chalk.dim('Run'), chalk.cyan('celune'), chalk.dim('to set up.'));
    process.exit(1);
  }
  return config;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // fall through to the status line
  }
  return `HTTP ${res.status}`;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export function registerBrainCommands(program: Command): void {
  const brain = program
    .command('brain')
    .description('Export or import workspace brain data (memories, relations, manifest)');

  brain
    .command('export')
    .description('Download the workspace brain as a versioned JSON file')
    .option('--api-url <url>', 'Celune API base URL', DEFAULT_API_URL)
    .option('-o, --out <file>', 'Output path (defaults to the server-provided filename)')
    .option('--compress', 'Force gzip output')
    .option('--no-compress', 'Force plain JSON output')
    .action(async (opts: { apiUrl: string; out?: string; compress?: boolean }) => {
      const config = requireConfig();
      const params = new URLSearchParams();
      if (opts.compress === true) params.set('compress', 'true');
      if (opts.compress === false) params.set('compress', 'false');
      const qs = params.toString();

      const spinner = ora('Exporting brain...').start();
      try {
        const res = await fetch(`${opts.apiUrl}/api/brain/export${qs ? `?${qs}` : ''}`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        if (!res.ok) {
          spinner.fail(`Export failed: ${await readError(res)}`);
          process.exit(1);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        const out =
          opts.out ??
          filenameFromDisposition(res.headers.get('content-disposition'), 'celune-brain.json');
        await writeFile(out, bytes);
        spinner.succeed(`Exported ${config.workspaceName} brain to ${chalk.cyan(out)}`);
        console.log(
          chalk.dim(
            `${(bytes.length / 1024).toFixed(1)} KB, format version ${res.headers.get('x-brain-format-version') ?? 'unknown'}`,
          ),
        );
      } catch (error) {
        spinner.fail(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  brain
    .command('import')
    .description('Upload a brain export into the connected workspace')
    .argument('<file>', 'Path to a .json or .json.gz brain export')
    .option('--api-url <url>', 'Celune API base URL', DEFAULT_API_URL)
    .option('-m, --mode <mode>', 'merge (default) or overwrite', 'merge')
    .option('--yes', 'Confirm an overwrite without prompting')
    .action(async (file: string, opts: { apiUrl: string; mode: string; yes?: boolean }) => {
      const config = requireConfig();
      if (opts.mode !== 'merge' && opts.mode !== 'overwrite') {
        console.log(chalk.red('mode must be merge or overwrite'));
        process.exit(1);
      }
      if (opts.mode === 'overwrite' && !opts.yes) {
        console.log(
          chalk.yellow(
            `Overwrite deletes every memory, relation, and manifest entry in ${config.workspaceName} before importing.`,
          ),
        );
        console.log(chalk.dim('Re-run with'), chalk.cyan('--yes'), chalk.dim('to confirm.'));
        process.exit(1);
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch {
        console.log(chalk.red(`Cannot read ${file}`));
        process.exit(1);
      }
      const gzip = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];

      const spinner = ora(`Importing brain (${opts.mode})...`).start();
      try {
        const res = await fetch(`${opts.apiUrl}/api/brain/import?mode=${opts.mode}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': gzip ? 'application/gzip' : 'application/json',
          },
          body: new Uint8Array(bytes),
        });
        if (!res.ok) {
          spinner.fail(`Import failed: ${await readError(res)}`);
          process.exit(1);
        }
        const result = (await res.json()) as {
          mode: string;
          counts: Record<string, { inserted: number; skipped: number }>;
          deleted?: Record<string, number>;
        };
        spinner.succeed(`Imported into ${config.workspaceName} (${result.mode})`);
        for (const [table, counts] of Object.entries(result.counts)) {
          const deleted = result.deleted?.[table];
          console.log(
            chalk.dim(`${table}:`),
            `${counts.inserted} inserted, ${counts.skipped} skipped` +
              (deleted !== undefined ? `, ${deleted} deleted` : ''),
          );
        }
      } catch (error) {
        spinner.fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
