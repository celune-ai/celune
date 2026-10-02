# @celuneai/cli

Command-line tool for Celune. It sets up a self-hosted Celune and connects AI coding tools (Claude Code, Cursor, Windsurf, VS Code) to a Celune workspace over MCP.

```bash
npx @celuneai/cli --help
# or
npm install -g @celuneai/cli
```

Requires Node.js 20 or later.

Run commands as `npx @celuneai/cli <command>`, or as `celune <command>` after a global install. The unscoped `celune` package on npm is unrelated; do not run `npx celune`.

## Commands

| Command          | What it does                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `celune init`    | Configures a self-hosted Celune: links a Supabase project or prepares the Docker stack, writes env files, and applies the schema                                  |
| `celune setup`   | Detects installed AI tools, authenticates, and writes their MCP configuration                                                                                     |
| `celune auth`    | Authenticates in the browser (device authorization flow)                                                                                                          |
| `celune status`  | Checks the connection                                                                                                                                             |
| `celune logout`  | Revokes the token and removes the MCP configuration it wrote                                                                                                      |
| `celune brain`   | Exports or imports workspace brain data (memories, relations, manifest)                                                                                           |
| `celune connect` | Detects the agent harness in a host repository, scaffolds a Celune harness adapter and config, installs the Celune skills, and checks the event route (`--check`) |

`celune init` must run from a checkout of [celune-ai/celune](https://github.com/celune-ai/celune). See its `SETUP.md` for the self-host guide.

`celune connect` is a dry run unless you pass `--write`, and it never overwrites a file without `--force`. See `docs/harness/connect.md` in the Celune repository.

## Development

```bash
pnpm --filter @celuneai/cli build
pnpm --filter @celuneai/cli test
node packages/cli/dist/index.js --help
```

## License

Apache-2.0
