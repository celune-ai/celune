# packages/brain

Template brain structure for Celune workspaces. This is a content package (no package.json / no npm exports) containing the default agent configurations, skills, memory structure, delegation rules, and settings that ship with every new workspace.

## Structure

```
core/
  agents/              # Default agent CLAUDE.md files
    pm/                  # Project manager agent
    lead-coder/          # Lead coder agent
    designer/            # Designer agent
    code-reviewer/       # Code reviewer agent
    researcher/          # Researcher agent
  delegation/          # Agent delegation and routing rules
    delegation-rules.md  # When to delegate to which agent
    mode-selection.md    # Auto/manual mode switching
    model-tiering.md     # Model tier assignments (Opus/Sonnet/Haiku)
    protocol.md          # Delegation protocol spec
  hooks/               # Default automation hooks
    slack-translator.sh  # Slack message formatting hook
    dependency-verification.sh  # Dep check hook
  memory/              # Default memory structure
    MEMORY.md            # Memory index template
    vault-structure.md   # Vault layout guide
    session-transcripts/ # Session transcript storage
  settings/            # Workspace settings
    permissions.md       # Default permission config
    mcp-config.json      # MCP server configuration
    statusline.sh        # Terminal status line
  state/               # Runtime state files
    active-branch.json   # Current git branch tracking
    active-workspace.json # Active workspace reference
    active-project.json  # Active project reference
```

## How It Works

When a new workspace is provisioned, the brain template is copied and customized with the workspace's specific settings. The `@repo/db/brain-manifest-registry` module manages the brain manifest in Supabase, while `@repo/db/brain-section-parser` and `@repo/db/brain-section-diff` handle parsing and diffing brain content for sync operations.
