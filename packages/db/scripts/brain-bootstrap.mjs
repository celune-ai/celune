#!/usr/bin/env node

/**
 * brain-bootstrap.mjs — Generate a second brain for a workspace
 *
 * Driven by the CORE Manifest Registry (packages/db/src/brain-manifest-registry.ts).
 * This script duplicates the manifest data as JS (see CORE_MANIFEST below) to avoid
 * a build step. The TS registry is the source of truth — keep in sync.
 *
 * Usage:
 *   node packages/db/scripts/brain-bootstrap.mjs \
 *     --workspace-id <uuid> \
 *     --tier <essential|standard|premium> \
 *     --use-case <web-app|mobile|ai-ml|content|fullstack|other> \
 *     [--autonomy <solo|supervised|autonomous>] \
 *     [--tdd <off|advisory|strict>] \
 *     [--tech-stack react,nodejs,postgres] \
 *     [--output-dir <path>]  # defaults to .claude/
 *     [--dry-run]            # preview without writing
 *     [--merge]              # skip files that already exist and aren't forked
 *
 * Manifest source of truth: packages/db/src/brain-manifest-registry.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CORE_BRAIN_DIR = join(MONOREPO_ROOT, 'packages', 'brain', 'core');

// ---------------------------------------------------------------------------
// CORE_MANIFEST — Mirror of packages/db/src/brain-manifest-registry.ts
// Keep in sync! The TS registry is the canonical source of truth.
// ---------------------------------------------------------------------------

const CORE_MANIFEST = [
  // SLASH SKILLS — Essential (13)
  {
    path: 'skills/build/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Execute projects end-to-end with full lifecycle',
    isCore: true,
  },
  {
    path: 'skills/task/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Create inbox tasks from analysis',
    isCore: true,
  },
  {
    path: 'skills/project/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Create full projects with grouped tasks',
    isCore: true,
  },
  {
    path: 'skills/refresh/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Re-sync workspace context',
    isCore: true,
  },
  {
    path: 'skills/quick-flush/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Mid-session memory save',
    isCore: true,
  },
  {
    path: 'skills/closing-time/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'End-of-session ritual with memory persistence',
    isCore: true,
  },
  {
    path: 'skills/todays-project/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Daily prioritized task list from Supabase',
    isCore: true,
  },
  {
    path: 'skills/git-push/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Push to branch and create PR',
    isCore: true,
  },
  {
    path: 'skills/git-deploy/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Full deploy pipeline (PR, CI, merge)',
    isCore: true,
  },
  {
    path: 'skills/lean/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Minimal context mode for performance',
    isCore: true,
  },
  {
    path: 'skills/research/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Deep market and technical research',
    isCore: true,
  },
  {
    path: 'skills/project-plan/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Lightweight plan project lifecycle',
    isCore: true,
  },
  {
    path: 'skills/security-audit/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Full security scan with task creation',
    isCore: true,
  },

  // SLASH SKILLS — Standard (10 — includes afk-* suite)
  {
    path: 'skills/deep-build/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Iterative verification loop for complex tasks',
    isCore: true,
  },
  {
    path: 'skills/project-research/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Research project lifecycle (Q&A to deliverable)',
    isCore: true,
  },
  {
    path: 'skills/auto-approve/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Autonomous execution mode with guardrails',
    isCore: true,
  },
  {
    path: 'skills/slack/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Pull Slack context before responding',
    isCore: true,
  },
  {
    path: 'skills/brain/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'PARA knowledge organization and semantic search',
    isCore: true,
  },
  {
    path: 'skills/afk-overnight/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Overnight autonomous task and research runner',
    isCore: true,
  },
  {
    path: 'skills/afk-building/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Autonomous platform feature building',
    isCore: true,
  },
  {
    path: 'skills/afk-housekeeping/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Cleanup task runner for low-hanging fruit',
    isCore: true,
  },
  {
    path: 'skills/afk-planning/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Autonomous backlog grooming',
    isCore: true,
  },

  // PROTOCOL SKILLS (not slash commands)
  {
    path: 'skills/debugging/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: '4-phase debugging protocol, stack-specific',
    isCore: true,
  },
  {
    path: 'skills/context-management/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Session degradation prevention',
    isCore: true,
  },
  {
    path: 'skills/tdd/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Red-green-refactor enforcement protocol',
    isCore: true,
  },
  {
    path: 'skills/code-review/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Quality checklist with quick and full modes',
    isCore: true,
  },
  {
    path: 'skills/worktree-workflow/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Parallel agent isolation via git worktrees',
    isCore: true,
  },

  // HOOKS
  {
    path: 'hooks/session-start.sh',
    tier: 'essential',
    category: 'hook',
    version: '1.0.0',
    description: 'CLI-to-platform bridge on session start',
    isCore: true,
  },
  {
    path: 'hooks/auto-format.sh',
    tier: 'essential',
    category: 'hook',
    version: '1.0.0',
    description: 'Prettier on Write/Edit tool use',
    isCore: true,
  },
  {
    path: 'hooks/dependency-verification.sh',
    tier: 'essential',
    category: 'hook',
    version: '1.0.0',
    description: 'Verify dependencies before install (toggleable)',
    isCore: true,
  },
  {
    path: 'hooks/tdd-enforcement.sh',
    tier: 'standard',
    category: 'hook',
    version: '1.0.0',
    description: 'Advisory warning, pairs with TDD skill',
    isCore: true,
  },
  {
    path: 'hooks/slack-translator.sh',
    tier: 'premium',
    category: 'hook',
    version: '1.0.0',
    description: 'Enterprise Slack integration hook',
    isCore: true,
  },

  // AGENTS
  {
    path: 'agents/lead-coder/CLAUDE.md',
    tier: 'essential',
    category: 'agent',
    version: '1.0.0',
    description: 'Lead coder agent (RICK-type) — codes directly',
    isCore: true,
  },
  {
    path: 'agents/code-reviewer/CLAUDE.md',
    tier: 'essential',
    category: 'agent',
    version: '1.0.0',
    description: 'Code reviewer agent (SCAN-type) — quality gate',
    isCore: true,
  },
  {
    path: 'agents/pm/CLAUDE.md',
    tier: 'standard',
    category: 'agent',
    version: '1.0.0',
    description: 'Project manager agent (SAGE-type)',
    isCore: true,
  },
  {
    path: 'agents/designer/CLAUDE.md',
    tier: 'standard',
    category: 'agent',
    version: '1.0.0',
    description: 'Designer agent (NOIR-type)',
    isCore: true,
  },
  {
    path: 'agents/researcher/CLAUDE.md',
    tier: 'standard',
    category: 'agent',
    version: '1.0.0',
    description: 'Researcher agent (DELV-type)',
    isCore: true,
  },

  // AGENT DOCS
  {
    path: 'agent_docs/task-management.md',
    tier: 'essential',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Core workflow reference for task system',
    isCore: true,
  },
  {
    path: 'agent_docs/prompt-template.md',
    tier: 'essential',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Prompt caching and cost optimization guide',
    isCore: true,
  },
  {
    path: 'agent_docs/skill-workflow.md',
    tier: 'essential',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'End-to-end skill chaining reference',
    isCore: true,
  },
  {
    path: 'agent_docs/research-tool-stack.md',
    tier: 'essential',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Web research tools and patterns',
    isCore: true,
  },
  {
    path: 'agent_docs/README-WORKTREES.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Worktree orchestration overview',
    isCore: true,
  },
  {
    path: 'agent_docs/worktree-quick-ref.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Quick reference for worktree commands',
    isCore: true,
  },
  {
    path: 'agent_docs/WORKTREE-SUMMARY.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Worktree architecture summary',
    isCore: true,
  },
  {
    path: 'agent_docs/WORKTREE-VISUAL-GUIDE.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Visual guide for worktree patterns',
    isCore: true,
  },
  {
    path: 'agent_docs/TMUX-WORKTREE-SETUP.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'tmux + worktree setup guide',
    isCore: true,
  },
  {
    path: 'agent_docs/error-metrics.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Error tracking and metrics for Code Reviewer',
    isCore: true,
  },

  // SETTINGS & CONFIG
  {
    path: 'settings/statusline.sh',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'CLI statusline with workspace badge',
    isCore: true,
  },
  {
    path: 'settings/mcp-config.json',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'MCP server configuration (Supabase connection)',
    isCore: true,
  },
  {
    path: 'settings/permissions.md',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'Allow/deny lists and safety rails',
    isCore: true,
  },
  {
    path: 'state/active-workspace.json',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'Active workspace context persistence',
    isCore: true,
  },
  {
    path: 'state/active-project.json',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'Active project context persistence',
    isCore: true,
  },
  {
    path: 'state/active-branch.json',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'Active branch context persistence',
    isCore: true,
  },

  // MEMORY SYSTEM
  {
    path: 'memory/MEMORY.md',
    tier: 'essential',
    category: 'memory',
    version: '1.0.0',
    description: 'Auto-persisted second brain core file',
    isCore: true,
  },
  {
    path: 'memory/vault-structure.md',
    tier: 'essential',
    category: 'memory',
    version: '1.0.0',
    description: 'PARA vault folder structure definition',
    isCore: true,
  },
  {
    path: 'memory/session-transcripts/',
    tier: 'essential',
    category: 'memory',
    version: '1.0.0',
    description: 'Session transcript storage directory',
    isCore: true,
  },

  // DELEGATION PROTOCOL
  {
    path: 'delegation/model-tiering.md',
    tier: 'essential',
    category: 'delegation',
    version: '1.0.0',
    description: 'Opus/Sonnet/Haiku model cost optimization',
    isCore: true,
  },
  {
    path: 'delegation/mode-selection.md',
    tier: 'standard',
    category: 'delegation',
    version: '1.0.0',
    description: 'Solo/sub-agents/team mode selection rules',
    isCore: true,
  },
  {
    path: 'delegation/delegation-rules.md',
    tier: 'standard',
    category: 'delegation',
    version: '1.0.0',
    description: 'Multi-agent coordination rules',
    isCore: true,
  },
  {
    path: 'delegation/protocol.md',
    tier: 'standard',
    category: 'delegation',
    version: '1.0.0',
    description: 'Full delegation protocol documentation',
    isCore: true,
  },
];

// ---------------------------------------------------------------------------
// Manifest access (tier gating removed — all users get full brain)
// ---------------------------------------------------------------------------

function getManifestForTier(_tier) {
  return [...CORE_MANIFEST];
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    workspaceId: '',
    tier: 'essential',
    useCase: 'other',
    autonomy: 'supervised',
    tdd: 'advisory',
    techStack: [],
    outputDir: join(process.cwd(), '.claude'),
    dryRun: false,
    merge: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--workspace-id':
        opts.workspaceId = args[++i];
        break;
      case '--tier':
        opts.tier = args[++i];
        break;
      case '--use-case':
        opts.useCase = args[++i];
        break;
      case '--autonomy':
        opts.autonomy = args[++i];
        break;
      case '--tdd':
        opts.tdd = args[++i];
        break;
      case '--tech-stack':
        opts.techStack = args[++i].split(',').map((s) => s.trim());
        break;
      case '--output-dir':
        opts.outputDir = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--merge':
        opts.merge = true;
        break;
    }
  }

  // Tier param accepted for backwards compatibility but ignored (all users get full brain)

  return opts;
}

// ---------------------------------------------------------------------------
// BrainConfig — passed to all content generators
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BrainConfig
 * @property {string} useCase
 * @property {string} autonomy
 * @property {string} tdd
 * @property {string[]} techStack
 * @property {string} tier
 */

function buildConfig(opts) {
  return {
    useCase: opts.useCase,
    autonomy: opts.autonomy,
    tdd: opts.tdd,
    techStack: opts.techStack,
    tier: opts.tier,
  };
}

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

function computeContentHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Supabase REST API helper
// ---------------------------------------------------------------------------

function loadEnv() {
  try {
    const envPath = join(MONOREPO_ROOT, 'apps', 'admin', '.env.local');
    const envContent = readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

async function upsertManifestRow(env, workspaceId, entry, contentHash) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const row = {
    workspace_id: workspaceId,
    path: entry.path,
    content_hash: contentHash,
    version: entry.version,
    tier: entry.tier,
    category: entry.category,
    is_core: entry.isCore,
    ownership_scope: entry.ownershipScope || 'core',
    is_forked: false,
    update_available: false,
  };

  const res = await fetch(`${url}/rest/v1/brain_manifest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`  MANIFEST ERROR (${entry.path}): ${res.status} ${text}`);
    return null;
  }
  return row;
}

async function fetchExistingManifest(env, workspaceId) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Map();

  const res = await fetch(
    `${url}/rest/v1/brain_manifest?workspace_id=eq.${workspaceId}&select=path,content_hash,is_forked`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  );

  if (!res.ok) return new Map();
  const rows = await res.json();
  const map = new Map();
  for (const r of rows) {
    map.set(r.path, r);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Content Generators
// ---------------------------------------------------------------------------

/**
 * Generate file content for a manifest entry.
 *
 * Primary source: packages/brain/core/ files (real, generalized content).
 * Fallback: inline generators (basic templates).
 *
 * Returns null for directory entries (path ends with /).
 */
function generateContent(entry, config) {
  // Directory entries — just create the directory
  if (entry.path.endsWith('/')) return null;

  // Try to read from packages/brain/core/ first
  const coreFilePath = join(CORE_BRAIN_DIR, entry.path);
  try {
    if (existsSync(coreFilePath)) {
      const content = readFileSync(coreFilePath, 'utf8');
      if (content.trim().length > 0) {
        return content;
      }
    }
  } catch {
    // Fall through to inline generators
  }

  // Fallback: inline generators for entries not yet in core/
  switch (entry.category) {
    case 'skill':
      return generateSkillContent(entry, config);
    case 'hook':
      return generateHookContent(entry, config);
    case 'agent':
      return generateAgentContent(entry, config);
    case 'agent_doc':
      return generateAgentDocContent(entry, config);
    case 'settings':
      return generateSettingsContent(entry, config);
    case 'memory':
      return generateMemoryContent(entry, config);
    case 'delegation':
      return generateDelegationContent(entry, config);
    default:
      return `# ${entry.description}\n\n<!-- Generated by brain-bootstrap -->\n`;
  }
}

// --- SKILLS ---

function generateSkillContent(entry, config) {
  const name = entry.path.split('/')[1]; // skills/<name>/CLAUDE.md
  const desc = entry.description;

  // Map of skill names to their content generators
  const generators = {
    build: generateSkillBuild,
    task: generateSkillTask,
    project: generateSkillProject,
    refresh: generateSkillRefresh,
    'quick-flush': generateSkillQuickFlush,
    'closing-time': generateSkillClosingTime,
    'todays-project': generateSkillTodaysProject,
    'git-push': generateSkillGitPush,
    'git-deploy': generateSkillGitDeploy,
    lean: generateSkillLean,
    research: generateSkillResearch,
    'project-plan': generateSkillProjectPlan,
    'security-audit': generateSkillSecurityAudit,
    'deep-build': generateSkillDeepBuild,
    'project-research': generateSkillProjectResearch,
    'auto-approve': generateSkillAutoApprove,
    slack: generateSkillSlack,
    brain: generateSkillBrain,
    'afk-overnight': generateSkillAfk,
    'afk-building': generateSkillAfk,
    'afk-housekeeping': generateSkillAfk,
    'afk-planning': generateSkillAfk,
    debugging: generateSkillDebugging,
    'context-management': generateSkillContextManagement,
    tdd: generateSkillTdd,
    'code-review': generateSkillCodeReview,
    'worktree-workflow': generateSkillWorktreeWorkflow,
  };

  const gen = generators[name];
  if (gen) return gen(name, desc, config);

  // Fallback
  return `# ${name.charAt(0).toUpperCase() + name.slice(1)} Skill

${desc}

## When to Use
Invoke with \`/${name}\` in Claude Code.

## Protocol
1. Assess the current context
2. Execute the skill workflow
3. Report results

<!-- Generated by brain-bootstrap. Populate with real content. -->
`;
}

function generateSkillBuild(name, desc, config) {
  return `# /build — Project Builder

${desc}

## Trigger
User says \`/build\` or \`/build <project-name>\`.

## Protocol
1. **Select project**: If not specified, show active projects and ask
2. **Review PRD**: Confirm PRD exists and is approved (\`prd_metadata.status = "approved"\`)
3. **Check tasks**: List all tasks for the project, confirm they're ready
4. **Execute**: Work through tasks sequentially — claim, implement, complete
5. **Close**: Run closing gates (Code Review, Design Feedback, Retro)

## Gates
- PRD must be approved before starting
- Each task must be claimed before work begins
- Code Review and Design Feedback are required before marking project done

## Tech Stack
${config.techStack.length > 0 ? config.techStack.map((t) => `- ${t}`).join('\n') : '- (auto-detect from codebase)'}
`;
}

function generateSkillTask(name, desc, config) {
  return `# /task — Task Creator

${desc}

## Trigger
User says \`/task\` after discussing work to be done.

## Protocol
1. Extract task details from conversation context
2. Generate structured description (## What / ## Approach / ## Blockers)
3. Create task via Supabase with status \`inbox\`
4. Title: 70 character max, imperative mood
5. Assign to appropriate agent or leave unassigned

## Task Description Format
\`\`\`markdown
## What
Concrete description of the change.

## Approach
1. Step one
2. Step two

## Blockers
None or list specific blockers.
\`\`\`
`;
}

function generateSkillProject(name, desc, config) {
  return `# /project — Project Creator

${desc}

## Trigger
User says \`/project\` to create a new feature project.

## Protocol
1. **Intake**: Gather project name, description, and goals
2. **PRD**: Generate a Product Requirements Document
3. **Tasks**: Break the PRD into implementation tasks
4. **Create**: Insert project + tasks into Supabase
5. **Confirm**: Show project summary with task count

## Project Types
- \`feature\`: Full lifecycle (PRD, impl, CR, DF, Retro)
- \`system\`: System-controlled items
- \`research\`: Q&A intake, research tasks, deliverable

## Rules
- Every project must belong to a workspace (workspace_id NOT NULL)
- Intent check: confirm project matches active workspace context
`;
}

function generateSkillRefresh(name, desc, config) {
  return `# /refresh — Context Refresh

${desc}

## Trigger
User says \`/refresh\` to re-sync workspace context.

## Protocol
1. Re-read MEMORY.md for latest state
2. Check active workspace and project from state files
3. Query Supabase for current task board status
4. Summarize: what changed since last read
`;
}

function generateSkillQuickFlush(name, desc, config) {
  return `# /quick-flush — Mid-Session Memory Save

${desc}

## Trigger
User says \`/quick-flush\` during a session.

## Protocol
1. Scan conversation for new learnings, decisions, and discoveries
2. Append to MEMORY.md under appropriate sections
3. Confirm what was saved
`;
}

function generateSkillClosingTime(name, desc, config) {
  return `# /closing-time — End-of-Session Ritual

${desc}

## Trigger
User says \`/closing-time\` to end a session.

## Protocol
1. **Tasks**: Update all in-progress tasks (complete or note progress)
2. **Memory**: Persist session learnings to MEMORY.md
3. **Summary**: Generate session summary (what was done, what's next)
4. **Reminders**: Surface any closing-time reminders
5. **Handoff**: Write handoff notes for next session
`;
}

function generateSkillTodaysProject(name, desc, config) {
  return `# /todays-project — Daily Task List

${desc}

## Trigger
User says \`/todays-project\` at start of session.

## Protocol
1. Query Supabase for tasks with status \`planning\` or \`in_progress\`
2. Sort by priority (high > medium > low) and due date
3. Present as numbered list with project context
4. Ask which task to start with
`;
}

function generateSkillGitPush(name, desc, config) {
  return `# /git-push — Branch Push & PR

${desc}

## Trigger
User says \`/git-push\` to push current work.

## Protocol
1. Check git status for uncommitted changes
2. Stage and commit if needed
3. Push to remote branch (create if needed)
4. Create PR if one doesn't exist for this branch
5. Report PR URL
`;
}

function generateSkillGitDeploy(name, desc, config) {
  return `# /git-deploy — Full Deploy Pipeline

${desc}

## Trigger
User says \`/git-deploy\` for full deployment.

## Protocol
1. Run /git-push first (ensure PR exists)
2. Wait for CI checks to pass
3. Request review if required
4. Merge PR when approved
5. Monitor deployment status
`;
}

function generateSkillLean(name, desc, config) {
  return `# /lean — Minimal Context Mode

${desc}

## Trigger
User says \`/lean\` for performance-focused sessions.

## Protocol
1. Skip reading MEMORY.md and large context files
2. Work only with files directly relevant to the task
3. Minimize tool calls — read only what you need
4. Avoid expanding search scope beyond immediate task
`;
}

function generateSkillResearch(name, desc, config) {
  return `# /research — Deep Research

${desc}

## Trigger
User says \`/research <topic>\`.

## Protocol
1. **Scope**: Clarify research question and boundaries
2. **Local**: Search codebase and memory for existing knowledge
3. **Web**: Use WebSearch/WebFetch for external sources
4. **Synthesize**: Combine findings into structured summary
5. **Persist**: Save key findings to memory or create tasks
`;
}

function generateSkillProjectPlan(name, desc, config) {
  return `# /project-plan — Lightweight Plan Project

${desc}

## Trigger
User says \`/project-plan\` for planning-only projects.

## Protocol
1. Gather plan name and goals
2. Generate PRD
3. Create tasks for the plan
4. Skip implementation — plan projects are for scoping only
5. Close with retro when plan is reviewed
`;
}

function generateSkillSecurityAudit(name, desc, config) {
  return `# /security-audit — Security Scan

${desc}

## Trigger
User says \`/security-audit\` for a security review.

## Protocol
1. **Auth**: Check authentication and authorization patterns
2. **Input**: Validate input handling and sanitization
3. **Secrets**: Scan for leaked credentials or API keys
4. **Deps**: Check for known vulnerable dependencies
5. **Headers**: Verify security headers (CSRF, CORS, CSP)
6. **Tasks**: Create tasks for each finding
`;
}

function generateSkillDeepBuild(name, desc, config) {
  return `# /deep-build — Iterative Verification Build

${desc}

## Trigger
User says \`/deep-build\` for complex implementation tasks.

## Protocol
1. Implement in small increments
2. After each increment: type-check, test, verify
3. If verification fails, fix before proceeding
4. Loop until all requirements are met
5. Final full verification pass
`;
}

function generateSkillProjectResearch(name, desc, config) {
  return `# /project-research — Research Project

${desc}

## Trigger
User says \`/project-research\` for research-type projects.

## Protocol
1. **Q&A Intake**: Gather research questions
2. **Create project**: Type \`research\`, with research tasks
3. **Execute**: Work through research tasks
4. **Deliverable**: Produce research summary/document
5. **Retro**: Close with retrospective
`;
}

function generateSkillAutoApprove(name, desc, config) {
  return `# /auto-approve — Autonomous Mode

${desc}

## Trigger
User says \`/auto-approve\` to enable autonomous execution.

## Protocol
1. Enable auto-approve mode for the session
2. Skip human confirmation gates (PRD approval, design review)
3. Still enforce: tests pass, type-check passes, no security issues
4. Log all autonomous decisions for review

## Guardrails
- Never auto-approve destructive git operations
- Never auto-approve changes to auth/security code without review
- Always create tasks for autonomous work
`;
}

function generateSkillSlack(name, desc, config) {
  return `# /slack — Slack Context

${desc}

## Trigger
User says \`/slack\` before responding to Slack messages.

## Protocol
1. Read relevant Slack channel/thread
2. Understand the context and question
3. Formulate response with appropriate tone
4. Draft message for user review before sending
`;
}

function generateSkillBrain(name, desc, config) {
  return `# /brain — Knowledge Organization

${desc}

## Trigger
User says \`/brain\` for knowledge management.

## Protocol
1. Organize knowledge using PARA method (Projects, Areas, Resources, Archive)
2. Search existing brain files for relevant context
3. Create or update knowledge entries
4. Maintain semantic connections between entries
`;
}

function generateSkillAfk(name, desc, config) {
  const modes = {
    'afk-overnight': {
      title: 'Overnight Runner',
      focus: 'Run queued tasks and research overnight',
    },
    'afk-building': { title: 'Autonomous Builder', focus: 'Build platform features autonomously' },
    'afk-housekeeping': { title: 'Cleanup Runner', focus: 'Clean up low-hanging fruit tasks' },
    'afk-planning': { title: 'Backlog Groomer', focus: 'Groom and prioritize the backlog' },
  };
  const mode = modes[name] || { title: name, focus: desc };

  return `# /${name} — ${mode.title}

${mode.focus}

## Trigger
User says \`/${name}\` to start autonomous work.

## Protocol
1. Check for approved tasks matching this mode
2. Claim tasks and work through them sequentially
3. Complete each task with outcome documentation
4. Generate summary report when done

## Safety
- Only work on tasks explicitly queued for AFK execution
- Stop if any task fails unexpectedly
- Send notification/email when complete
`;
}

function generateSkillDebugging(name, desc, config) {
  return `# Systematic Debugging Skill

4-phase protocol for structured debugging. Follow phases in order — no skipping.

## Phase 1: REPRODUCE
Confirm the bug exists before investigating.
1. Get the exact error message, stacktrace, or unexpected behavior
2. Identify reproduction steps
3. Reproduce the bug yourself
4. Document: expected vs actual

**GATE: Do NOT proceed until you can reproduce the bug.**

## Phase 2: ISOLATE
Trace from symptom to specific code location.
1. Read the error stacktrace — start from the deepest frame
2. Check recent changes (git log, git diff)
3. Add logging/breakpoints at the suspected location
4. Narrow to the exact line/function

## Phase 3: FIX
Apply the minimal correct fix.
1. Understand WHY the bug exists (root cause, not symptom)
2. Write the fix — minimal change, no refactoring
3. Run the failing test/reproduction — confirm it passes
4. Run the full test suite — confirm no regressions

## Phase 4: VERIFY
Confirm the fix is complete and safe.
1. All tests pass
2. Type check passes
3. No related edge cases missed
4. Commit with clear message referencing the bug
`;
}

function generateSkillContextManagement(name, desc, config) {
  return `# Context Management Skill

Manage conversation context to prevent quality degradation in long sessions.

## When to Use
- Session exceeds 50% context utilization
- Working on 3+ files simultaneously
- Switching between unrelated tasks

## Protocol
1. **Checkpoint**: Write key decisions and current state to MEMORY.md
2. **Scope**: Focus on one task at a time — complete it before switching
3. **Summarize**: Before context gets large, write a handoff summary:
   - What was done
   - What's in progress
   - What's next
   - Key decisions made
4. **Compact**: Use /compact when context utilization is high

## Anti-patterns
- Don't hold entire file contents in context — read, process, close
- Don't keep stale search results — summarize findings immediately
- Don't re-read files you've already processed in the same session
`;
}

function generateSkillTdd(name, desc, config) {
  return `# Test-Driven Development Skill

Write tests before implementation for critical logic.

## When to Use TDD
- New API endpoints or business logic
- Bug fixes (write failing test first)
- Complex algorithms or data transformations

## When NOT to Use TDD
- UI components (visual testing is better)
- Configuration changes
- Documentation updates

## Protocol
1. **Red**: Write a failing test that defines the expected behavior
2. **Green**: Write the minimal code to make the test pass
3. **Refactor**: Clean up without changing behavior — tests still pass
4. Repeat for each requirement

## TDD Mode: ${config.tdd}
${
  config.tdd === 'strict'
    ? '- STRICT: Tests are required before any implementation code.'
    : config.tdd === 'advisory'
      ? '- ADVISORY: Tests are recommended but not blocking.'
      : '- OFF: TDD not enforced.'
}
`;
}

function generateSkillCodeReview(name, desc, config) {
  return `# Code Review Skill

Structured code review protocol for quality assurance.

## Review Checklist
1. **Correctness**: Does the code do what the task says?
2. **Security**: Auth, input validation, no leaked secrets, no injection
3. **Quality**: Clean types, no over-engineering, follows patterns
4. **Tests**: Critical paths tested? Tests deterministic?
5. **Formatting**: Prettier/linter passes

## Process
1. Run automated suite: type-check, build, test, prettier
2. Read every changed file — understand the intent
3. Check for regressions in adjacent code
4. Write structured findings (file, line, issue, fix)
5. Auto-fix issues, don't just report them
`;
}

function generateSkillWorktreeWorkflow(name, desc, config) {
  return `# Worktree Workflow Skill

Use git worktrees for parallel development without branch switching.

## When to Use
- Running multiple tasks in parallel via sub-agents
- Need to test a fix while keeping current work intact
- Building features that shouldn't touch main branch

## Commands
\`\`\`bash
# Create worktree
git worktree add ../worktree-name branch-name

# List worktrees
git worktree list

# Remove worktree (after merging)
git worktree remove ../worktree-name
\`\`\`

## Rules
- Always merge worktree changes into project branch immediately after completion
- Delete worktree branches after merging
- Never leave dangling worktree branches
`;
}

// --- HOOKS ---

function generateHookContent(entry, config) {
  const name = entry.path.split('/').pop(); // hooks/<name>.sh

  const generators = {
    'session-start.sh': generateHookSessionStart,
    'auto-format.sh': generateHookAutoFormat,
    'dependency-verification.sh': generateHookDependencyVerification,
    'tdd-enforcement.sh': generateHookTddEnforcement,
    'slack-translator.sh': generateHookSlackTranslator,
  };

  const gen = generators[name];
  if (gen) return gen(config);

  return `#!/bin/bash\n# ${entry.description}\nset -euo pipefail\n\necho "${name} hook executed"\n`;
}

function generateHookSessionStart(config) {
  return `#!/bin/bash
# session-start.sh — Runs at the start of each Claude Code session
# Checks for pending tasks and surfaces them

set -euo pipefail

echo "Session started at $(date '+%Y-%m-%d %H:%M:%S')"

# Check for pending tasks if task CLI is available
if command -v node &>/dev/null; then
  TASK_CLI="packages/db/scripts/task-cli.mjs"
  if [ -f "$TASK_CLI" ]; then
    echo "Checking for pending tasks..."
    node "$TASK_CLI" list --status planning --limit 5 2>/dev/null || true
  fi
fi
`;
}

function generateHookAutoFormat(config) {
  return `#!/bin/bash
# auto-format.sh — Auto-format code after edits
# Runs prettier on changed files

set -euo pipefail

# Only run if prettier is available
if command -v npx &>/dev/null && [ -f ".prettierrc" ] || [ -f "prettier.config.js" ]; then
  CHANGED_FILES=$(git diff --name-only --cached 2>/dev/null || echo "")
  if [ -n "$CHANGED_FILES" ]; then
    echo "$CHANGED_FILES" | xargs npx prettier --write 2>/dev/null || true
  fi
fi
`;
}

function generateHookDependencyVerification(config) {
  return `#!/bin/bash
# dependency-verification.sh — Verify dependencies before install
# Toggleable via brain settings

set -euo pipefail

if [ -f "pnpm-lock.yaml" ]; then
  if ! pnpm install --frozen-lockfile --prefer-offline 2>/dev/null; then
    echo "Warning: Dependencies may be out of sync. Run 'pnpm install'."
  fi
elif [ -f "package-lock.json" ]; then
  if ! npm ci 2>/dev/null; then
    echo "Warning: Dependencies may be out of sync. Run 'npm install'."
  fi
elif [ -f "yarn.lock" ]; then
  if ! yarn install --frozen-lockfile 2>/dev/null; then
    echo "Warning: Dependencies may be out of sync. Run 'yarn install'."
  fi
fi
`;
}

function generateHookTddEnforcement(config) {
  const mode = config.tdd || 'advisory';
  return `#!/bin/bash
# tdd-enforcement.sh — Enforce test coverage on commits
# Mode: ${mode}

set -euo pipefail

MODE="${mode}"

# Get staged files
STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || echo "")

# Check if any source files are staged
SRC_FILES=$(echo "$STAGED" | grep -E '\\.(ts|tsx|js|jsx)$' | grep -v '\\.test\\.' | grep -v '__tests__' || true)

if [ -z "$SRC_FILES" ]; then
  exit 0
fi

# Check for corresponding test files
MISSING_TESTS=""
for f in $SRC_FILES; do
  TEST_FILE=$(echo "$f" | sed 's/\\.\\(ts\\|tsx\\|js\\|jsx\\)$/.test.\\1/')
  if [ ! -f "$TEST_FILE" ]; then
    MISSING_TESTS="$MISSING_TESTS\\n  $f"
  fi
done

if [ -n "$MISSING_TESTS" ]; then
  if [ "$MODE" = "strict" ]; then
    echo "TDD ENFORCEMENT (strict): Missing test files for:$MISSING_TESTS"
    echo "Create test files before committing."
    exit 1
  else
    echo "TDD ADVISORY: Consider adding tests for:$MISSING_TESTS"
  fi
fi
`;
}

function generateHookSlackTranslator(config) {
  return `#!/bin/bash
# slack-translator.sh — Enterprise Slack integration hook
# Translates Slack events into workspace context

set -euo pipefail

# This hook is triggered by Slack webhook events
# It reads the event payload and updates workspace context

PAYLOAD="\${1:-}"
if [ -z "$PAYLOAD" ]; then
  echo "No Slack payload provided"
  exit 0
fi

echo "Processing Slack event..."
# Implementation: parse payload, update context, notify agents
`;
}

// --- AGENTS ---

function generateAgentContent(entry, config) {
  const agentId = entry.path.split('/')[1]; // agents/<id>/CLAUDE.md

  const agentMeta = {
    'lead-coder': {
      name: 'Lead Coder',
      model: 'opus',
      role: 'Architecture, implementation, code quality. Codes directly — delegation only for parallelism.',
    },
    'code-reviewer': {
      name: 'Code Reviewer',
      model: 'sonnet',
      role: 'Code review, QA, security audit. Quality gate for all PRs.',
    },
    pm: {
      name: 'Project Manager',
      model: 'sonnet',
      role: 'Product strategy, requirements, roadmap. Owns PRDs and task scoping.',
    },
    designer: {
      name: 'Designer',
      model: 'sonnet',
      role: 'UX/UI design, prototyping, accessibility. Owns design review gate.',
    },
    researcher: {
      name: 'Researcher',
      model: 'haiku',
      role: 'Technical research, competitive analysis, literature review.',
    },
  };

  const meta = agentMeta[agentId] || { name: agentId, model: 'sonnet', role: entry.description };

  return `# ${meta.name}

**Role:** ${meta.role}
**Model:** claude-${meta.model}-4-6

## Responsibilities
- Own ${meta.role.split('.')[0].toLowerCase()} tasks within the workspace.
- Follow the delegation protocol for cross-agent coordination.
- Claim tasks at start, complete on delivery.

## Constraints
- Stay within your domain — escalate cross-domain work to the Lead.
- Every piece of work gets a task. No exceptions.
- Follow existing codebase patterns and conventions.
`;
}

// --- AGENT DOCS ---

function generateAgentDocContent(entry, config) {
  const name = entry.path.split('/').pop(); // agent_docs/<name>.md

  const generators = {
    'task-management.md': () => `# Task Management

All work is tracked through Supabase tasks. Every agent must:

1. **Create** a task before starting work
2. **Claim** the task: \`node packages/db/scripts/task-cli.mjs claim <id> --agent <name>\`
3. **Complete** the task: \`node packages/db/scripts/task-cli.mjs complete <id> --agent <name> --outcome "..."\`

## Task Statuses
- \`inbox\` — New, unprocessed
- \`planning\` — Scoped and ready for execution
- \`in_progress\` — Actively being worked on
- \`review\` — Awaiting review
- \`done\` — Completed

## Task Description Format
\`\`\`markdown
## What
What changes, be concrete.

## Approach
Numbered implementation steps.

## Blockers
None or specific blockers.
\`\`\`
`,
    'prompt-template.md': () => `# Prompt Template

Use this structure for agent prompts to maximize cache hits:

1. **Identity** (stable, cached): Who the agent is, role, model
2. **Rules** (stable, cached): Constraints, conventions, patterns
3. **Process** (stable, cached): Step-by-step workflow
4. **Task** (variable): Specific task details

The first three sections should be identical across invocations.
The task section is the only part that changes per-invocation.
`,
    'skill-workflow.md': () => `# Skill Workflow

Skills are invokable protocols that guide Claude Code behavior.

## Creating a Skill
1. Create \`.claude/skills/<name>/CLAUDE.md\`
2. Write the protocol (what it does, when to use, steps)
3. Register in settings if needed

## Invoking Skills
- Type \`/<skill-name>\` in Claude Code
- Skills auto-load from \`.claude/skills/\` directory

## Skill Chaining
Skills can invoke other skills. For example:
- \`/build\` invokes \`/task\` for each implementation step
- \`/closing-time\` invokes \`/quick-flush\` for memory persistence

## Best Practices
- Keep skills focused — one task per skill
- Include clear triggers (when to use)
- Include anti-patterns (when NOT to use)
- Test with real scenarios before shipping
`,
    'research-tool-stack.md': () => `# Research Tool Stack

Layered approach to information gathering:

## Layer 1: Local Knowledge
- MEMORY.md and memory files
- Codebase search (Grep, Glob)

## Layer 2: Web Search
- WebSearch for general queries
- WebFetch for specific URLs

## Layer 3: Deep Extraction
- Full page content extraction
- YouTube transcript analysis

## Best Practices
- Start local, expand outward
- Cite sources for all claims
- Cross-reference multiple sources
- Summarize findings immediately (don't hold raw results in context)
`,
    'README-WORKTREES.md': () => `# Worktree Orchestration

Git worktrees enable parallel agent development without branch conflicts.

## Architecture
- Main repo: primary development
- Worktrees: isolated checkouts for parallel agents
- Each worktree gets its own branch

## Setup
\`\`\`bash
git worktree add .claude/worktrees/agent-<name> -b worktree-agent-<name>
\`\`\`

## Lifecycle
1. Create worktree for agent task
2. Agent works in isolation
3. Merge changes back to project branch
4. Remove worktree and branch

## Rules
- Never leave dangling worktree branches
- Merge immediately after completion
- One worktree per agent per task
`,
    'worktree-quick-ref.md': () => `# Worktree Quick Reference

## Create
\`\`\`bash
git worktree add <path> <branch>
git worktree add .claude/worktrees/fix-123 -b fix-123
\`\`\`

## List
\`\`\`bash
git worktree list
\`\`\`

## Remove
\`\`\`bash
git worktree remove <path>
git branch -d <branch>  # after merging
\`\`\`

## Prune (clean stale)
\`\`\`bash
git worktree prune
\`\`\`
`,
    'WORKTREE-SUMMARY.md': () => `# Worktree Architecture Summary

Worktrees provide filesystem-level isolation for parallel agent work.
Each agent gets a separate checkout of the repo, avoiding merge conflicts
during simultaneous development.

## Key Benefits
- No branch switching needed
- Agents can build and test independently
- Changes merge cleanly via standard git merge

## Constraints
- A branch can only be checked out in one worktree
- Worktrees share the same .git directory
- Large repos may consume significant disk space
`,
    'WORKTREE-VISUAL-GUIDE.md': () => `# Worktree Visual Guide

## Layout
\`\`\`
repo/                          # Main worktree (project branch)
  .claude/worktrees/
    agent-a/                   # Agent A worktree
    agent-b/                   # Agent B worktree
\`\`\`

## Flow
\`\`\`
main ──> project-branch ──> agent-a-branch (worktree)
                         ──> agent-b-branch (worktree)
                         <── merge agent-a
                         <── merge agent-b
     <── PR merge
\`\`\`
`,
    'TMUX-WORKTREE-SETUP.md': () => `# tmux + Worktree Setup

## Session Layout
\`\`\`bash
# Create tmux session with panes per agent
tmux new-session -d -s agents
tmux split-window -h
tmux split-window -v

# Pane 0: Lead agent (main repo)
# Pane 1: Agent A (worktree A)
# Pane 2: Agent B (worktree B)
\`\`\`

## Navigation
- Alt+Arrow: switch panes
- Mouse mode enabled for click navigation
- Each pane runs Claude Code in its own worktree

## Tips
- Use distinct shell prompts per agent for visual clarity
- Monitor all panes to catch blocking issues early
`,
    'error-metrics.md': () => `# Error Metrics — Code Reviewer Reference

## Categories
- **Type errors**: TypeScript compilation failures
- **Runtime errors**: Exceptions caught in production/staging
- **Test failures**: Broken or flaky tests
- **Lint violations**: ESLint/Prettier failures
- **Security issues**: Auth, injection, secret exposure

## Tracking
- Log each finding with: file, line, category, severity, fix status
- Aggregate by category and severity for trend analysis
- Track fix rate: findings resolved vs. total findings

## Severity Levels
- **Critical**: Security vulnerabilities, data loss risk
- **High**: Broken functionality, regression
- **Medium**: Code quality, maintainability
- **Low**: Style, documentation
`,
  };

  const gen = generators[name];
  if (gen) return gen();

  return `# ${entry.description}\n\n<!-- Generated by brain-bootstrap. Populate with real content. -->\n`;
}

// --- SETTINGS ---

function generateSettingsContent(entry, config) {
  const filename = entry.path.split('/').pop();

  if (entry.path === 'settings/statusline.sh') {
    return `#!/bin/bash
# statusline.sh — CLI statusline with workspace badge
# Displays active workspace and project context

WORKSPACE_FILE=".claude/state/active-workspace.json"
PROJECT_FILE=".claude/state/active-project.json"

WS_NAME="(none)"
PROJ_NAME=""

if [ -f "$WORKSPACE_FILE" ]; then
  WS_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORKSPACE_FILE','utf8')).name || '(none)')" 2>/dev/null || echo "(none)")
fi

if [ -f "$PROJECT_FILE" ]; then
  PROJ_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_FILE','utf8')).name || '')" 2>/dev/null || echo "")
fi

if [ -n "$PROJ_NAME" ]; then
  echo "[$WS_NAME] $PROJ_NAME"
else
  echo "[$WS_NAME]"
fi
`;
  }

  if (entry.path === 'settings/mcp-config.json') {
    return (
      JSON.stringify(
        {
          mcpServers: {
            supabase: {
              command: 'npx',
              args: ['-y', '@supabase/mcp-server'],
              env: {
                SUPABASE_URL: '${NEXT_PUBLIC_SUPABASE_URL}',
                SUPABASE_SERVICE_ROLE_KEY: '${SUPABASE_SERVICE_ROLE_KEY}',
              },
            },
          },
        },
        null,
        2,
      ) + '\n'
    );
  }

  if (entry.path === 'settings/permissions.md') {
    return `# Permissions & Safety Rails

## Allow List
- Read any file in the workspace
- Write files in the workspace (non-destructive)
- Run build, test, lint commands
- Git operations (commit, push, branch)
- Supabase queries via MCP

## Deny List
- Never delete production data
- Never push to main/master without PR
- Never commit secrets or credentials
- Never run destructive git operations without confirmation
- Never modify files outside the workspace

## Autonomy Level: ${config.autonomy}
${
  config.autonomy === 'autonomous'
    ? '- Auto-approve non-destructive operations'
    : config.autonomy === 'supervised'
      ? '- Require confirmation for significant changes'
      : '- Solo mode: all operations require explicit approval'
}
`;
  }

  if (entry.path === 'state/active-workspace.json') {
    return JSON.stringify({ id: null, name: null, tier: config.tier }, null, 2) + '\n';
  }

  if (entry.path === 'state/active-project.json') {
    return JSON.stringify({ id: null, name: null, type: null }, null, 2) + '\n';
  }

  if (entry.path === 'state/active-branch.json') {
    return JSON.stringify({ name: null, pr_url: null }, null, 2) + '\n';
  }

  return `# ${entry.description}\n\n<!-- Generated by brain-bootstrap -->\n`;
}

// --- MEMORY ---

function generateMemoryContent(entry, config) {
  if (entry.path === 'memory/MEMORY.md') {
    return `# Workspace Memory

## Architecture
<!-- Auto-populated as the agent learns your codebase -->

## Conventions
<!-- Code style, naming patterns, preferred libraries -->

## Key Files
<!-- Important file paths and their purposes -->

## Known Gaps
<!-- Technical debt, missing features, known issues -->
`;
  }

  if (entry.path === 'memory/vault-structure.md') {
    return `# PARA Vault Structure

Organize knowledge using the PARA method:

## Projects
Active projects with clear outcomes and deadlines.
Location: \`memory/projects/\`

## Areas
Ongoing areas of responsibility (no end date).
Location: \`memory/areas/\`

## Resources
Reference material, guides, templates.
Location: \`memory/resources/\`

## Archive
Completed or inactive items.
Location: \`memory/archive/\`
`;
  }

  // Directory entry (session-transcripts/) — handled by directory creation
  return null;
}

// --- DELEGATION ---

function generateDelegationContent(entry, config) {
  const name = entry.path.split('/').pop();

  if (name === 'model-tiering.md') {
    return `# Model Tiering

Cost-optimize by matching model to task complexity:

## Opus (highest capability, highest cost)
- Architecture decisions
- Complex implementations
- Critical bug fixes
- Lead agent work

## Sonnet (balanced capability/cost)
- Code review
- Project management
- Design review
- Standard implementations

## Haiku (fastest, lowest cost)
- Research tasks
- Simple lookups
- Documentation
- Routine maintenance

## Rule of Thumb
Use the cheapest model that can do the job. Escalate to a more capable model only when the task exceeds the current model's ability.
`;
  }

  if (name === 'mode-selection.md') {
    return `# Mode Selection

Choose the right execution mode based on task characteristics:

## Solo (default)
One agent handles everything. Best for:
- Simple tasks
- Tasks requiring deep context
- Sequential work

## Sub-agents
Delegate subtasks to cheaper models. Best for:
- Parallelizable work
- Research + implementation combos
- Code review while continuing development

## Agent Team
Multiple independent agents with shared memory. Best for:
- Large features with independent components
- Sprint execution with 3+ parallel tasks
- Cross-domain work (frontend + backend + docs)

## Decision Matrix
| Complexity | Parallelism | Mode |
|-----------|-------------|------|
| Low       | No          | Solo |
| Medium    | Some        | Sub-agents |
| High      | Yes         | Agent Team |
`;
  }

  if (name === 'delegation-rules.md') {
    return `# Delegation Rules

## Core Principles
1. The Lead codes directly — delegation is for parallelism, not hierarchy
2. Every delegated task gets a Supabase task (assigned to the delegate)
3. Delegate to the cheapest model that can handle the task
4. Merge delegate work immediately — no dangling branches

## Handoff Protocol
1. Create a task for the delegate
2. Assign it: \`update <id> --assignee <agent-name>\`
3. Provide clear context: what, where, constraints
4. Monitor progress via task board
5. Review and merge on completion

## Anti-patterns
- Don't delegate to avoid understanding the problem
- Don't create agent hierarchies deeper than 2 levels
- Don't leave delegate tasks unreviewed
`;
  }

  if (name === 'protocol.md') {
    return `# Delegation Protocol

## Overview
Multi-agent coordination protocol for Claude Code workspaces.

## Roles
- **Lead**: Primary agent, codes directly, coordinates delegation
- **Delegate**: Sub-agent working on a specific task
- **Reviewer**: Quality gate for delegate work

## Workflow
1. Lead identifies parallelizable work
2. Lead creates tasks and assigns to delegates
3. Delegates work in worktrees (isolated branches)
4. Lead reviews delegate work
5. Lead merges approved work into project branch

## Communication
- Shared memory files for cross-agent context
- Task board reflects real-time state
- Worktree branches named by agent for visibility

## Conflict Resolution
- Lead makes final decisions on conflicts
- If delegates disagree, escalate to Lead
- Code review findings are binding
`;
  }

  return `# ${entry.description}\n\n<!-- Generated by brain-bootstrap. Populate with real content. -->\n`;
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

function writeFile(outputDir, relativePath, content, opts) {
  const fullPath = join(outputDir, relativePath);

  // Directory entry
  if (relativePath.endsWith('/')) {
    if (opts.dryRun) {
      console.log(`  WOULD MKDIR: ${relativePath}`);
      return { path: relativePath, action: 'dry-run', bytes: 0 };
    }
    if (opts.merge && existsSync(fullPath)) {
      console.log(`  SKIP (exists): ${relativePath}`);
      return { path: relativePath, action: 'skipped', bytes: 0 };
    }
    mkdirSync(fullPath, { recursive: true });
    console.log(`  MKDIR: ${relativePath}`);
    return { path: relativePath, action: 'created', bytes: 0 };
  }

  if (opts.merge && existsSync(fullPath)) {
    console.log(`  SKIP (exists): ${relativePath}`);
    return { path: relativePath, action: 'skipped', bytes: content ? content.length : 0 };
  }

  if (opts.dryRun) {
    const bytes = content ? content.length : 0;
    console.log(`  WOULD WRITE: ${relativePath} (${bytes} bytes)`);
    return { path: relativePath, action: 'dry-run', bytes };
  }

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  console.log(`  WROTE: ${relativePath} (${content.length} bytes)`);
  return { path: relativePath, action: 'created', bytes: content.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  const config = buildConfig(opts);
  const env = loadEnv();

  console.log(`\nBrain Bootstrap — Celune Second Brain Generator`);
  console.log(`================================================`);
  console.log(`Workspace:  ${opts.workspaceId || '(local — no manifest tracking)'}`);
  console.log(`Tier:       full (all components — tier gating removed)`);
  console.log(`Use case:   ${opts.useCase}`);
  console.log(`Autonomy:   ${opts.autonomy}`);
  console.log(`TDD:        ${opts.tdd}`);
  console.log(`Tech stack: ${opts.techStack.join(', ') || '(none specified)'}`);
  console.log(`Output:     ${opts.outputDir}`);
  console.log(`Mode:       ${opts.dryRun ? 'DRY RUN' : opts.merge ? 'MERGE' : 'OVERWRITE'}`);
  console.log('');

  // Get manifest entries for the requested tier
  const entries = getManifestForTier(opts.tier);
  console.log(`Manifest: ${entries.length} entries (full brain)\n`);

  // If merge mode + workspace, fetch existing manifest
  let existingManifest = new Map();
  if (opts.merge && opts.workspaceId) {
    console.log('Fetching existing manifest entries...');
    existingManifest = await fetchExistingManifest(env, opts.workspaceId);
    console.log(`  Found ${existingManifest.size} existing entries\n`);
  }

  const results = [];
  const manifestUpserts = [];
  let currentCategory = '';

  for (const entry of entries) {
    // Print category header
    if (entry.category !== currentCategory) {
      currentCategory = entry.category;
      console.log(`${currentCategory.toUpperCase()}:`);
    }

    // In merge mode with manifest, skip non-forked entries that haven't changed
    if (opts.merge && existingManifest.has(entry.path)) {
      const existing = existingManifest.get(entry.path);
      if (!existing.is_forked) {
        console.log(`  SKIP (manifest, not forked): ${entry.path}`);
        results.push({ path: entry.path, action: 'skipped' });
        continue;
      }
    }

    // Generate content
    const content = generateContent(entry, config);

    // Write file
    const result = writeFile(opts.outputDir, entry.path, content, opts);
    results.push(result);

    // Make hooks executable
    if (entry.category === 'hook' && !opts.dryRun && result.action === 'created') {
      const fullPath = join(opts.outputDir, entry.path);
      try {
        chmodSync(fullPath, 0o755);
      } catch {
        // chmod may fail on some systems
      }
    }

    // Upsert to brain_manifest if workspace provided
    if (opts.workspaceId && !opts.dryRun && content && result.action === 'created') {
      const hash = computeContentHash(content);
      manifestUpserts.push(upsertManifestRow(env, opts.workspaceId, entry, hash));
    }
  }

  // Await all manifest upserts
  if (manifestUpserts.length > 0) {
    console.log(`\nUpserting ${manifestUpserts.length} manifest rows...`);
    const upsertResults = await Promise.allSettled(manifestUpserts);
    const succeeded = upsertResults.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = upsertResults.filter((r) => r.status === 'rejected' || !r.value).length;
    console.log(`  Succeeded: ${succeeded}, Failed: ${failed}`);
  }

  // Summary
  const created = results.filter((r) => r.action === 'created').length;
  const skipped = results.filter((r) => r.action === 'skipped').length;
  const dryRun = results.filter((r) => r.action === 'dry-run').length;

  const byCat = {};
  for (const entry of entries) {
    byCat[entry.category] = (byCat[entry.category] || 0) + 1;
  }

  console.log(`\n================================================`);
  console.log(`Brain bootstrap complete!`);
  if (created > 0) console.log(`  Created:      ${created} files`);
  if (skipped > 0) console.log(`  Skipped:      ${skipped} files`);
  if (dryRun > 0) console.log(`  Would create: ${dryRun} files`);
  console.log(`  Total entries: ${entries.length}`);
  for (const [cat, count] of Object.entries(byCat)) {
    console.log(`    ${cat}: ${count}`);
  }

  return { results, total: entries.length, byCat };
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
