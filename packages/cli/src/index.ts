import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { authenticate } from './auth.js';
import { deviceAuth } from './device-auth.js';
import { detectTools, getInstalledTools } from './detect.js';
import { configureAllTools, removeCeluneConfig } from './configure.js';
import { loadConfig, saveConfig, deleteConfig } from './config-store.js';
import { DEFAULT_API_URL } from './defaults.js';
import { registerBrainCommands } from './commands/brain.js';
import { registerConnectCommand } from './commands/connect.js';
import { registerInitCommand } from './commands/init.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { cliCommand } from './invocation.js';

// Replaced with the package.json version by tsup at build time.
declare const __CELUNE_CLI_VERSION__: string | undefined;
const VERSION = typeof __CELUNE_CLI_VERSION__ === 'string' ? __CELUNE_CLI_VERSION__ : '0.0.0-dev';

const CLI = cliCommand();
const program = new Command();

program.name(CLI).description('Connect your AI coding tools to Celune').version(VERSION);

program
  .command('setup', { isDefault: true })
  .description('Detect AI tools, authenticate, and configure MCP')
  .option('--api-url <url>', 'Celune API base URL', DEFAULT_API_URL)
  .option('--code <setup-code>', 'One-time setup code (legacy)')
  .option('--token <key>', 'API key (skip browser auth)')
  .option('--tool <name>', 'Configure a specific tool only (claude-code, cursor, windsurf, cline)')
  .option('--non-interactive', 'Skip prompts, use CELUNE_API_KEY env var')
  .action(
    async (opts: {
      apiUrl: string;
      code?: string;
      token?: string;
      tool?: string;
      nonInteractive?: boolean;
    }) => {
      console.log();
      console.log(chalk.bold(`Celune CLI v${VERSION}`));
      console.log(chalk.dim('─'.repeat(40)));
      console.log();

      // Step 1: Detect installed tools
      const spinner = ora('Scanning for AI coding tools...').start();
      const allTools = await detectTools();
      const installed = allTools.filter((t) => t.installed);
      spinner.succeed(`Found ${installed.length} AI tool${installed.length !== 1 ? 's' : ''}`);

      if (installed.length === 0) {
        console.log();
        console.log(chalk.yellow('No AI coding tools detected.'));
        console.log(chalk.dim('Supported: Claude Code, Cursor, Windsurf, Cline (VS Code)'));
        console.log(chalk.dim('Install one of these tools first, then run celune again.'));
        process.exit(1);
      }

      // Filter to specific tool if --tool flag provided
      let toolsToSetup = installed;
      if (opts.tool) {
        const match = installed.find((t) => t.name === opts.tool);
        if (!match) {
          console.log();
          console.log(chalk.red(`Tool "${opts.tool}" not found or not installed.`));
          console.log(chalk.dim('Installed tools:'));
          for (const tool of installed) {
            console.log(chalk.dim(`  - ${tool.name} (${tool.displayName})`));
          }
          process.exit(1);
        }
        toolsToSetup = [match];
      }

      // Show detected tools with selection info
      for (const tool of allTools) {
        const selected = toolsToSetup.some((t) => t.name === tool.name);
        if (tool.installed && selected) {
          console.log(chalk.green('  ✓'), tool.displayName);
        } else if (tool.installed) {
          console.log(
            chalk.dim('  ○'),
            chalk.dim(`${tool.displayName} — skipped (use --tool ${tool.name})`),
          );
        } else {
          console.log(chalk.dim('  ○'), chalk.dim(`${tool.displayName} — not detected`));
        }
      }
      console.log();

      // Step 2: Check for existing config or authenticate
      let apiKey: string;
      let workspaceId: string;
      let workspaceName: string;

      if (opts.code) {
        // Legacy: exchange one-time setup code for API key
        const codeSpinner = ora('Exchanging setup code...').start();
        try {
          const res = await fetch(`${opts.apiUrl}/api/auth/cli-exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: opts.code }),
          });

          if (!res.ok) {
            const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
              error?: string;
            };
            codeSpinner.fail(body.error || 'Failed to exchange setup code');
            process.exit(1);
          }

          const data = (await res.json()) as {
            api_key: string;
            workspace_id: string;
            workspace_name: string;
            user_id: string;
            email: string;
          };
          apiKey = data.api_key;
          workspaceId = data.workspace_id;
          workspaceName = data.workspace_name;

          saveConfig({
            apiKey,
            workspaceId,
            workspaceName,
            userId: data.user_id,
            email: data.email,
            mcpEndpoint: `${opts.apiUrl}/api/mcp`,
            installedAt: new Date().toISOString(),
          });
          codeSpinner.succeed(`Authenticated as ${data.email}`);
        } catch {
          codeSpinner.fail('Could not reach Celune API');
          process.exit(1);
        }
      } else if (opts.token || process.env.CELUNE_API_KEY || opts.nonInteractive) {
        // Direct token auth (for CI, scripts)
        apiKey = opts.token || process.env.CELUNE_API_KEY || '';
        if (!apiKey) {
          console.log(chalk.red('Provide --token <key> or set CELUNE_API_KEY.'));
          process.exit(1);
        }
        workspaceId = process.env.CELUNE_WORKSPACE_ID || '';
        workspaceName = '';
        console.log(chalk.green('✓'), 'Using provided API key');
      } else {
        let existing = loadConfig();

        // Verify stored key is still valid (also updates last_used_at so the
        // platform UI polling detects the connection immediately).
        if (existing) {
          const healthUrl = existing.mcpEndpoint
            ? existing.mcpEndpoint.replace(/\/mcp\/?$/, '/mcp/health')
            : `${opts.apiUrl}/api/mcp/health`;
          const verifySpinner = ora('Verifying connection...').start();
          try {
            const healthRes = await fetch(healthUrl, {
              headers: { Authorization: `Bearer ${existing.apiKey}` },
            });
            if (healthRes.ok) {
              const health = (await healthRes.json()) as {
                user?: { email?: string };
                workspace?: { name?: string };
              };
              const email =
                health.user?.email && health.user.email !== 'unknown'
                  ? health.user.email
                  : existing.email;
              const wsName =
                health.workspace?.name && health.workspace.name !== 'unknown'
                  ? health.workspace.name
                  : existing.workspaceName;
              verifySpinner.succeed(`Connected as ${email} (${wsName})`);
            } else if (healthRes.status === 401) {
              verifySpinner.fail('Stored API key is no longer valid');
              deleteConfig();
              existing = null; // fall through to device auth below
            } else {
              verifySpinner.warn('Could not verify — continuing with stored credentials');
            }
          } catch {
            verifySpinner.warn('Could not reach server — continuing with stored credentials');
          }
        }

        if (existing) {
          console.log(chalk.dim('Reconfiguring tools with existing credentials...'));
          apiKey = existing.apiKey;
          workspaceId = existing.workspaceId;
          workspaceName = existing.workspaceName;
        } else {
          // Device authorization flow — open browser to /device/verify
          const authResult = await deviceAuth({ apiUrl: opts.apiUrl });
          apiKey = authResult.apiKey;
          workspaceId = authResult.workspaceId;
          workspaceName = authResult.workspaceName;

          saveConfig({
            apiKey,
            workspaceId,
            workspaceName,
            userId: authResult.userId,
            email: authResult.email,
            mcpEndpoint: `${opts.apiUrl}/api/mcp`,
            installedAt: new Date().toISOString(),
          });
        }
      }
      console.log();

      // Step 3: Configure MCP for selected tools
      const configSpinner = ora(
        `Configuring MCP for ${toolsToSetup.length} tool${toolsToSetup.length !== 1 ? 's' : ''}...`,
      ).start();
      const results = await configureAllTools(toolsToSetup, apiKey);
      configSpinner.succeed('MCP configured');

      for (const r of results) {
        if (r.action === 'error') {
          console.log(chalk.red('  ✗'), `${r.toolName}: ${r.error}`);
        } else {
          console.log(chalk.green('  ✓'), `${r.toolName} (${r.configPath})`);
        }
      }

      console.log();
      console.log(chalk.dim('─'.repeat(40)));
      console.log(chalk.green.bold('Setup complete!'));
      console.log(chalk.dim('Restart your AI tool to activate Celune.'));
      console.log();
      console.log(
        chalk.dim('Run'),
        chalk.cyan(`${CLI} status`),
        chalk.dim('to verify connection.'),
      );
      console.log();
    },
  );

program
  .command('auth')
  .description('Authenticate via browser (device authorization flow)')
  .option('--api-url <url>', 'Celune API base URL', DEFAULT_API_URL)
  .action(async (opts: { apiUrl: string }) => {
    console.log();
    console.log(chalk.bold(`Celune CLI v${VERSION}`));
    console.log(chalk.dim('─'.repeat(40)));
    console.log();

    const existing = loadConfig();
    if (existing) {
      console.log(chalk.dim(`Already connected as ${existing.email} (${existing.workspaceName})`));
      console.log(
        chalk.dim('Run'),
        chalk.cyan(`${CLI} logout`),
        chalk.dim('first to re-authenticate.'),
      );
      console.log();
      return;
    }

    const authResult = await deviceAuth({ apiUrl: opts.apiUrl });

    saveConfig({
      apiKey: authResult.apiKey,
      workspaceId: authResult.workspaceId,
      workspaceName: authResult.workspaceName,
      userId: authResult.userId,
      email: authResult.email,
      mcpEndpoint: `${opts.apiUrl}/api/mcp`,
      installedAt: new Date().toISOString(),
    });

    console.log();
    console.log(chalk.green.bold('Authenticated!'));
    console.log(
      chalk.dim('Run'),
      chalk.cyan(`${CLI} setup`),
      chalk.dim('to configure your AI tools.'),
    );
    console.log();
  });

program
  .command('status')
  .description('Check connection status')
  .option('--api-url <url>', 'Celune API base URL', DEFAULT_API_URL)
  .action(async (opts: { apiUrl: string }) => {
    const config = loadConfig();

    if (!config) {
      console.log(chalk.yellow('Not connected.'));
      console.log(chalk.dim('Run'), chalk.cyan(`${CLI} setup`), chalk.dim('to set up.'));
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold('Celune Status'));
    console.log(chalk.dim('─'.repeat(30)));

    // Check API connection
    const spinner = ora('Checking connection...').start();
    try {
      const res = await fetch(`${opts.apiUrl}/api/mcp/health`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });

      if (res.ok) {
        const data = (await res.json()) as {
          workspace?: { name?: string };
          user?: { email?: string };
          tools_available?: number;
          scopes?: string[];
        };
        spinner.succeed('Connected');
        console.log(chalk.dim('  Workspace:'), data.workspace?.name || config.workspaceName);
        console.log(chalk.dim('  Email:'), data.user?.email || config.email);
        console.log(chalk.dim('  Tools:'), data.tools_available ?? 'unknown');
        console.log(chalk.dim('  Scopes:'), (data.scopes || []).join(', '));
      } else if (res.status === 401) {
        spinner.fail('API key invalid or expired');
        console.log(
          chalk.dim('Run'),
          chalk.cyan(`${CLI} logout`),
          chalk.dim('then'),
          chalk.cyan(`${CLI} setup`),
          chalk.dim('to reconnect.'),
        );
      } else {
        spinner.fail(`API returned ${res.status}`);
      }
    } catch {
      spinner.fail('Could not reach Celune API');
      console.log(chalk.dim('  Endpoint:'), `${opts.apiUrl}/api/mcp/health`);
    }

    // Show configured tools
    console.log();
    const installed = await getInstalledTools();
    console.log(chalk.bold('Configured Tools'));
    for (const tool of installed) {
      console.log(chalk.green('  ✓'), tool.displayName, chalk.dim(`(${tool.configPath})`));
    }

    console.log();
  });

program
  .command('logout')
  .description('Revoke token and clean up configs')
  .action(async () => {
    const config = loadConfig();

    if (!config) {
      console.log(chalk.dim('Not connected — nothing to clean up.'));
      return;
    }

    const spinner = ora('Cleaning up...').start();

    // Remove MCP config from all tool configs
    const tools = await detectTools();
    for (const tool of tools) {
      if (tool.installed) {
        await removeCeluneConfig(tool.configPath);
      }
    }

    // Delete stored credentials
    deleteConfig();

    spinner.succeed('Logged out');
    console.log(chalk.dim('Celune MCP config removed from all AI tools.'));
    console.log(chalk.dim('Credentials deleted from ~/.celune/'));
    console.log();
  });

registerBrainCommands(program);
registerConnectCommand(program);
registerInitCommand(program);
registerWorkspaceCommands(program);

program.parse();
