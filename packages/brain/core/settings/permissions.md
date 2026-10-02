# Agent Permissions Template

Default permission configuration for AI agents in this workspace. Customize per agent or per role.

## Allow List (Default)

Actions agents are permitted to perform without explicit approval:

- **File Operations**: Read, create, and modify files within the project directory
- **Git Operations**: commit, branch, merge, push to feature branches
- **Package Management**: `pnpm install`, `pnpm add` (lead agent only)
- **Testing**: Run test suites (`pnpm test`, `pnpm type-check`)
- **Build**: Run builds (`pnpm build`)
- **Task CLI**: claim, block, unblock, complete, comment on tasks
- **MCP Tools**: Use configured MCP servers (Supabase, search, etc.)
- **Worktrees**: Create and remove git worktrees for parallel work

## Deny List (Default)

Actions that require explicit user approval:

- **Destructive Git**: `git push --force`, `git reset --hard`, `git clean -f`, force push to main/master
- **Production Deploy**: Manual deploys, environment variable changes
- **Secret Management**: Creating, modifying, or reading `.env` files, credentials, API keys
- **Database Mutations**: Direct SQL writes to production (use migrations instead)
- **Billing/Payment**: Any actions involving payment, subscription, or billing changes
- **External Communication**: Sending emails, Slack messages, or notifications on behalf of the user
- **Branch Deletion**: Deleting remote branches (local cleanup is allowed)
- **Config Changes**: Modifying CI/CD pipelines, deployment configs, DNS settings

## Safety Rails

### All Agents

- Never commit files containing secrets (`.env`, credentials, API keys)
- Never skip pre-commit hooks (`--no-verify`)
- Never force push to protected branches
- Always verify tests pass before completing a task
- Always include `--outcome` when completing tasks

### Sub-Agents (Non-Lead)

- Do not modify `package.json` or lock files (only the lead agent does this)
- Do not merge branches (only the lead agent merges)
- Do not push directly to main — work on your worktree branch
- Scope changes to the files relevant to your assigned task

### Lead Agent

- Review all sub-agent work before merging
- Merge branches serially (least-conflicting first)
- Clean up worktrees after merging
- Verify full test suite passes after each merge

## Per-Agent Overrides

To customize permissions for a specific agent, create a file at:
`.claude/agents/<agent-id>/permissions.md`

Override format:

```markdown
## Additional Allow

- [specific action for this agent]

## Additional Deny

- [specific restriction for this agent]
```
