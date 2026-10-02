import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { Command } from 'commander';
import chalk from 'chalk';
import { findRepoRoot, InitError, nextSteps, runInit, type InitMode } from '../init.js';

interface InitFlags {
  mode?: string;
  root?: string;
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  dbUrl?: string;
  siteUrl?: string;
  skipMigrations?: boolean;
  nonInteractive?: boolean;
}

/** Line prompts; `secret` answers are not echoed. */
function createPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return {
    async ask(question: string, secret = false): Promise<string> {
      process.stdout.write(question);
      muted = secret;
      const answer = await rl.question('');
      muted = false;
      if (secret) process.stdout.write('\n');
      return answer.trim();
    },
    close: () => rl.close(),
  };
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description(
      'Configure a self-hosted Celune (link a Supabase project or prepare the Docker stack)',
    )
    .option('--mode <mode>', 'supabase (link an existing project) or docker (compose stack)')
    .option('--root <dir>', 'Celune repository root (default: found from the current directory)')
    .option('--supabase-url <url>', 'Supabase project URL (env SUPABASE_URL)')
    .option('--anon-key <key>', 'Supabase anon key (env SUPABASE_ANON_KEY)')
    .option('--service-role-key <key>', 'Supabase service role key (env SUPABASE_SERVICE_ROLE_KEY)')
    .option('--db-url <url>', 'Postgres connection string (env DATABASE_URL)')
    .option('--site-url <url>', 'Public URL of the web app')
    .option('--skip-migrations', 'Write env files without applying migrations')
    .option('--non-interactive', 'Never prompt; fail when a value is missing')
    .action(async (flags: InitFlags) => {
      const interactive = !flags.nonInteractive && process.stdin.isTTY === true;
      const prompter = interactive ? createPrompter() : null;
      try {
        const root = flags.root ?? findRepoRoot(process.cwd());

        let mode = flags.mode?.toLowerCase();
        if (!mode && prompter) {
          console.log(chalk.bold('How do you want to run Celune?'));
          console.log('  A) Link an existing Supabase project');
          console.log('  B) Run the full stack with Docker Compose');
          const choice = (await prompter.ask('Choose A or B: ')).toLowerCase();
          mode = choice === 'a' ? 'supabase' : choice === 'b' ? 'docker' : choice;
        }
        if (mode !== 'supabase' && mode !== 'docker') {
          throw new InitError('Choose a mode: --mode supabase or --mode docker');
        }

        let supabase;
        if (mode === 'supabase') {
          const value = async (
            flag: string | undefined,
            env: string,
            label: string,
            secret: boolean,
          ) => {
            const given = flag ?? process.env[env];
            if (given) return given;
            if (!prompter) throw new InitError(`Missing ${label}: pass the flag or set ${env}`);
            return prompter.ask(`${label}: `, secret);
          };
          supabase = {
            url: await value(flags.supabaseUrl, 'SUPABASE_URL', 'Supabase URL', false),
            anonKey: await value(flags.anonKey, 'SUPABASE_ANON_KEY', 'Anon key', true),
            serviceRoleKey: await value(
              flags.serviceRoleKey,
              'SUPABASE_SERVICE_ROLE_KEY',
              'Service role key',
              true,
            ),
            dbUrl: await value(
              flags.dbUrl,
              'DATABASE_URL',
              'Database URL (postgresql://...)',
              true,
            ),
          };
        }
        prompter?.close();

        const result = runInit({
          root,
          mode: mode as InitMode,
          siteUrl: flags.siteUrl,
          supabase,
          skipMigrations: flags.skipMigrations,
          log: (line) => console.log(chalk.dim(`  ${line}`)),
        });

        console.log();
        console.log(chalk.green.bold('Celune is configured (community edition).'));
        if (result.migrated) console.log(chalk.dim('Migrations applied.'));
        console.log(chalk.bold('Next steps:'));
        for (const step of nextSteps(mode as InitMode, result.migrated)) {
          console.log(`  ${chalk.cyan(step)}`);
        }
        console.log();
      } catch (err) {
        prompter?.close();
        if (err instanceof InitError) {
          console.error(chalk.red(err.message));
          process.exit(1);
        }
        throw err;
      }
    });
}
