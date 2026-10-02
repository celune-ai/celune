# Auto-Approve Rules of Engagement

## ALWAYS DO (no prompting needed)

**Code & Files:**

- Read, edit, write, create any source file in the monorepo
- Read/write to `.claude/` directories (skills, memory, hooks, agents)
- Modify test files, config files, CI/CD within the repo
- Copy SQL migrations to `~/Documents/sqleditor/`

**Build & Verify:**

- Run `pnpm type-check`, `pnpm test`, `pnpm build`, `pnpm lint`
- Run `npx prettier --check .` and `npx prettier --write .`
- Run `npx tsc --noEmit` directly
- Run `turbo build`, `turbo type-check`

**Git:**

- `git status`, `git diff`, `git log`, `git add`, `git commit`
- `git branch`, `git checkout`, `git stash`, `git merge`
- Create new branches (`git checkout -b afk/...`)
- `git push origin <feature-branch>` (non-main branches)

**Task System:**

- Run `node packages/db/scripts/task-cli.mjs` (any command: create, claim, complete, comment, block, etc.)
- Create, claim, update, complete Supabase tasks
- Spawn sub-agents and agent teams

**Infrastructure:**

- Run Supabase MCP tools (`execute_sql`, `apply_migration`, `list_tables`)
- Run database migrations
- Install dev dependencies via `pnpm add -D`
- Kill stuck dev server processes (`kill`, `pkill` on node/next processes)

**Communication:**

- Send Slack messages (translation hook still applies)
- Fetch web content, search the web

## NEVER DO (hard stops — always ask the user first)

**Destructive Git:**

- `git push --force` or `git push --force-with-lease` to any branch
- `git push` to `main` or `master` (use `/deploy` skill instead)
- `git reset --hard` (prefer `git stash` or `git checkout -- <file>`)
- `git rebase` on shared/pushed branches

**PR Merge to Main:**

- NEVER auto-merge a PR into `main`. Always add `<maintainer>` as reviewer and wait for the maintainer's approval.
- Auto-approve/self-review merges are ONLY allowed for PRs targeting non-main branches (e.g., feature -> feature).
- This is non-negotiable — main is the production branch and requires human sign-off.

**Destructive Filesystem:**

- `rm -rf` on any directory outside `/tmp` or `node_modules`
- `rm -r` on any directory containing source code
- Delete `.env*` files or any file containing secrets
- `sudo` anything

**Destructive Database:**

- Drop or truncate tables in production
- Delete RLS policies without replacement
- Run `DELETE FROM` without a `WHERE` clause

**External Side Effects:**

- Run `curl`/`fetch` with POST/PUT/DELETE to external APIs not in the codebase
- Install production dependencies (`pnpm add` without `-D`) without confirmation
- Publish packages (`npm publish`, `pnpm publish`)
- Create or close GitHub PRs/issues (use `/deploy` for pushes)
- Send emails via MCP
- Modify system files outside the repo and `~/.claude/`
- `ssh`, `scp`, or `rsync` to remote servers

**Configuration:**

- Modify `~/.claude/settings.json` permission entries (the irony is intentional)
- Modify macOS system preferences (`defaults write`, `networksetup`)
- Modify LaunchAgents that aren't ours

## PAUSE AND CONFIRM (circuit breakers)

These are automatic stop conditions. If any trigger, stop autonomous execution, report the situation, and wait for the user's input:

- **Repeated failure**: Test suite or type-check fails 3+ times on the same error
- **Large blast radius**: A single file edit would exceed 300 lines of net changes
- **Ambiguous scope**: Task description is unclear enough that two reasonable approaches diverge significantly
- **Secrets detected**: Discover API keys, tokens, passwords, or credentials in code — flag immediately, do not commit
- **Merge conflicts**: Git merge or rebase produces conflicts — do not auto-resolve, report the files
- **Build cascade failure**: `pnpm build` fails and the error isn't in files you modified (upstream breakage)
- **Missing dependencies**: A task requires an external service, API key, or the user's credentials to proceed

## Permission Reference

### Allow list

- `Bash` — blanket (all commands auto-approved; deny list blocks destructive ones)
- `Read`, `Edit`, `Write`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `ToolSearch`
- `mcp__claude_ai_Slack__*`, `mcp__pencil`, `mcp__supabase__*`

### Deny list (blocked even with blanket Bash)

| Pattern                  | Reason                   |
| ------------------------ | ------------------------ |
| `Bash(sudo *)`           | Privilege escalation     |
| `Bash(shutdown *)`       | System control           |
| `Bash(reboot *)`         | System control           |
| `Bash(diskutil *)`       | Disk management          |
| `Bash(dscl *)`           | Directory services       |
| `Bash(networksetup *)`   | Network configuration    |
| `Bash(defaults write *)` | macOS system preferences |
| `Bash(scp *)`            | Remote access            |
| `Bash(rsync *)`          | Remote access            |
| `Bash(ssh *)`            | Remote access            |

**Why blanket instead of granular?** Granular `Bash(pnpm *)` patterns only match commands starting with that word. Claude Code frequently uses compound commands (`cd /path && pnpm type-check`) which start with `cd`, causing granular patterns to miss. Blanket `Bash` + deny list is the only approach that actually works.
