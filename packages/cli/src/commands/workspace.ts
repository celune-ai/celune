import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, strFromU8, unzipSync } from 'fflate';
import { loadConfig } from '../config-store.js';
import { DEFAULT_API_URL } from '../defaults.js';

export const WORKSPACE_FORMAT = 'celune-workspace';
export const SUPPORTED_WORKSPACE_VERSIONS: readonly number[] = [1];
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class WorkspaceCliError extends Error {}

type Kind = 'zip' | 'gzip' | 'json';

export function detectKind(bytes: Uint8Array): Kind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    return 'zip';
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  return 'json';
}

const CONTENT_TYPES: Record<Kind, string> = {
  zip: 'application/zip',
  gzip: 'application/gzip',
  json: 'application/json',
};

/** Reads the export header locally so a wrong file or newer version fails before upload. */
export function checkExportHeader(bytes: Uint8Array): { format_version: number } {
  const kind = detectKind(bytes);
  let text: string;
  try {
    if (kind === 'zip') {
      const files = unzipSync(bytes, { filter: (f) => f.name === 'workspace.json' });
      const doc = files['workspace.json'];
      if (!doc) throw new WorkspaceCliError('Archive has no workspace.json');
      text = strFromU8(doc);
    } else {
      text = strFromU8(kind === 'gzip' ? gunzipSync(bytes) : bytes);
    }
  } catch (error) {
    if (error instanceof WorkspaceCliError) throw error;
    throw new WorkspaceCliError('File is not a readable workspace export');
  }
  let doc: { format?: unknown; format_version?: unknown };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    throw new WorkspaceCliError('Export document is not valid JSON');
  }
  if (doc.format !== WORKSPACE_FORMAT) {
    throw new WorkspaceCliError(`Not a workspace export (expected format "${WORKSPACE_FORMAT}")`);
  }
  const version = doc.format_version;
  if (typeof version !== 'number' || !SUPPORTED_WORKSPACE_VERSIONS.includes(version)) {
    throw new WorkspaceCliError(
      `Unsupported workspace export format_version ${String(version)}. This CLI supports: ${SUPPORTED_WORKSPACE_VERSIONS.join(', ')}. Update the CLI.`,
    );
  }
  return { format_version: version };
}

export interface ImportOptions {
  file: string;
  apiUrl: string;
  apiKey: string;
  mode: 'merge' | 'overwrite';
  fetchImpl?: typeof fetch;
}

export interface ImportResponse {
  mode: string;
  counts: Record<string, { inserted: number; skipped: number }>;
  deleted?: Record<string, number>;
  attachments_without_bytes?: number;
  brain?: { counts: Record<string, { inserted: number; skipped: number }> } | null;
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

export async function runWorkspaceImport(opts: ImportOptions): Promise<ImportResponse> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(opts.file));
  } catch {
    throw new WorkspaceCliError(`Cannot read ${opts.file}`);
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new WorkspaceCliError(`File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }
  checkExportHeader(bytes);

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.apiUrl}/api/workspace/import?mode=${opts.mode}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': CONTENT_TYPES[detectKind(bytes)],
    },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) throw new WorkspaceCliError(`Import failed: ${await readError(res)}`);
  return (await res.json()) as ImportResponse;
}

function resolveAuth(opts: { apiUrl?: string; token?: string }): {
  apiUrl: string;
  apiKey: string;
} {
  const config = loadConfig();
  const apiKey = opts.token ?? process.env.CELUNE_API_KEY ?? config?.apiKey;
  if (!apiKey) {
    console.log(chalk.yellow('No API key.'));
    console.log(
      chalk.dim('Set CELUNE_API_KEY, pass --token, or run'),
      chalk.cyan('celune'),
      chalk.dim('to connect.'),
    );
    process.exit(1);
  }
  return { apiUrl: (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, ''), apiKey };
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program
    .command('workspace')
    .description('Export or import a whole workspace (projects, tasks, agents, brain)');

  workspace
    .command('import')
    .description(
      'Load a workspace export (.zip, .json, or .json.gz) into the workspace of the API key',
    )
    .argument('<file>', 'Path to the export')
    .option('--api-url <url>', 'Instance URL (defaults to CELUNE_API_URL)')
    .option('--token <key>', 'API key with write scope (defaults to CELUNE_API_KEY)')
    .option('-m, --mode <mode>', 'merge (default) or overwrite', 'merge')
    .option('--yes', 'Confirm an overwrite without prompting')
    .action(
      async (
        file: string,
        opts: { apiUrl?: string; token?: string; mode: string; yes?: boolean },
      ) => {
        if (opts.mode !== 'merge' && opts.mode !== 'overwrite') {
          console.log(chalk.red('mode must be merge or overwrite'));
          process.exit(1);
        }
        if (opts.mode === 'overwrite' && !opts.yes) {
          console.log(
            chalk.yellow(
              'Overwrite deletes the projects, tasks, comments, agent configs, and brain of the target workspace before importing.',
            ),
          );
          console.log(chalk.dim('Re-run with'), chalk.cyan('--yes'), chalk.dim('to confirm.'));
          process.exit(1);
        }
        const auth = resolveAuth(opts);
        const spinner = ora(`Importing workspace (${opts.mode})...`).start();
        try {
          const result = await runWorkspaceImport({
            file,
            ...auth,
            mode: opts.mode as ImportOptions['mode'],
          });
          spinner.succeed(`Imported into ${auth.apiUrl} (${result.mode})`);
          const rows = { ...result.counts, ...(result.brain?.counts ?? {}) };
          for (const [table, counts] of Object.entries(rows)) {
            const deleted = result.deleted?.[table];
            console.log(
              chalk.dim(`${table}:`),
              `${counts.inserted} inserted, ${counts.skipped} skipped` +
                (deleted !== undefined ? `, ${deleted} deleted` : ''),
            );
          }
          if (result.attachments_without_bytes) {
            console.log(
              chalk.dim(
                `${result.attachments_without_bytes} attachment(s) had no file in the export and were skipped.`,
              ),
            );
          }
        } catch (error) {
          spinner.fail(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      },
    );

  workspace
    .command('export')
    .description('Download the workspace of the API key as a zip (or JSON with --json)')
    .option('--api-url <url>', 'Instance URL (defaults to CELUNE_API_URL)')
    .option('--token <key>', 'API key with read scope (defaults to CELUNE_API_KEY)')
    .option('-o, --out <file>', 'Output path (defaults to the server-provided filename)')
    .option('--json', 'Export the JSON document only, without attachments')
    .action(async (opts: { apiUrl?: string; token?: string; out?: string; json?: boolean }) => {
      const auth = resolveAuth(opts);
      const spinner = ora('Exporting workspace...').start();
      try {
        const res = await fetch(
          `${auth.apiUrl}/api/workspace/export?format=${opts.json ? 'json' : 'zip'}`,
          { headers: { Authorization: `Bearer ${auth.apiKey}` } },
        );
        if (!res.ok) throw new WorkspaceCliError(`Export failed: ${await readError(res)}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const out =
          opts.out ??
          filenameFromDisposition(
            res.headers.get('content-disposition'),
            opts.json ? 'celune-workspace.json' : 'celune-workspace.zip',
          );
        await writeFile(out, bytes);
        spinner.succeed(`Exported workspace to ${chalk.cyan(out)}`);
      } catch (error) {
        spinner.fail(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
