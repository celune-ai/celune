/**
 * CORE Brain Manifest Registry
 *
 * Canonical source of truth for all brain components shipped with Celune.
 * Checked into git — Supabase brain_manifest is a per-workspace sync of this registry.
 *
 * Each entry defines a component's path (relative to .claude/), tier, category,
 * version, and metadata. Content generators live elsewhere (bootstrap rewrite, Sprint 2).
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ManifestTier = 'essential' | 'standard' | 'premium';

export type ManifestCategory =
  'skill' | 'hook' | 'agent' | 'agent_doc' | 'memory' | 'settings' | 'delegation';

export type ManifestOwnershipScope = 'core' | 'org' | 'workspace';

/** Integration group for categorizing brain updates. null = always-on core. */
export type ManifestIntegrationGroup = 'github' | 'slack' | 'voice' | 'byok' | null;

export interface ManifestEntry {
  /** Relative to .claude/ (e.g. "skills/build/CLAUDE.md") */
  path: string;
  tier: ManifestTier;
  category: ManifestCategory;
  /** Semver — bumped when content changes */
  version: string;
  /** Human-readable one-liner */
  description: string;
  /** true = Celune-provided core component */
  isCore: boolean;
  /** Three-tier ownership: core (platform), org (team-shared), workspace (user-owned). Defaults to 'core'. */
  ownershipScope?: ManifestOwnershipScope;
  /** Integration group — null means core (always available). */
  integrationGroup?: ManifestIntegrationGroup;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve ownershipScope, defaulting to 'core' */
export function resolveOwnershipScope(entry: ManifestEntry): ManifestOwnershipScope {
  return entry.ownershipScope ?? 'core';
}

/** SHA-256 hex digest of arbitrary content */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Return manifest entries available at the given tier.
 *
 * NOTE: Tier gating has been removed — all users get the full brain regardless
 * of plan. The tier parameter is accepted for API compatibility but ignored.
 * The `tier` field on each entry is preserved as internal metadata only.
 */
export function getManifestForTier(_tier?: ManifestTier): ManifestEntry[] {
  return [...CORE_MANIFEST];
}

/** Return manifest entries matching a specific category */
export function getManifestByCategory(category: ManifestCategory): ManifestEntry[] {
  return CORE_MANIFEST.filter((e) => e.category === category);
}

/** Return manifest entries matching a specific integration group (null = core) */
export function getManifestByIntegrationGroup(group: ManifestIntegrationGroup): ManifestEntry[] {
  return CORE_MANIFEST.filter((e) => (e.integrationGroup ?? null) === group);
}

// ---------------------------------------------------------------------------
// Code Example Extraction
// ---------------------------------------------------------------------------

/** A single code block extracted from skill content. */
export interface ExtractedCodeBlock {
  code: string;
  language: string;
  /** Line index in source where the block started (0-based). */
  startLine: number;
}

/**
 * Extract fenced code blocks from markdown content.
 * Returns code blocks with their language tags.
 * Minimum 3 lines to filter out trivial one-liners.
 */
export function extractCodeBlocks(content: string): ExtractedCodeBlock[] {
  const blocks: ExtractedCodeBlock[] = [];
  const lines = content.split('\n');
  let inBlock = false;
  let currentLang = 'text';
  let currentCode: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && line.match(/^```(\w*)/)) {
      inBlock = true;
      currentLang = RegExp.$1 || 'text';
      currentCode = [];
      startLine = i;
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      // Only keep blocks with 3+ lines of actual code
      if (currentCode.length >= 3) {
        blocks.push({
          code: currentCode.join('\n'),
          language: normalizeLang(currentLang),
          startLine,
        });
      }
    } else if (inBlock) {
      currentCode.push(line);
    }
  }

  return blocks;
}

/** Normalize common language aliases. */
function normalizeLang(lang: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    '': 'text',
  };
  return map[lang.toLowerCase()] ?? lang.toLowerCase();
}

/**
 * Generate a simple summary for a code block.
 * No LLM — uses heuristics: first comment, function name, or truncated first line.
 * Returns a 1-sentence summary.
 */
export function summarizeCodeBlock(code: string, language: string): string {
  const lines = code.trim().split('\n');

  // Try to find a leading comment
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
      const comment = trimmed.replace(/^\/\/\s*|^#\s*|^--\s*/, '').trim();
      if (comment.length > 10) return comment;
    }
  }

  // Try to find a function/class declaration
  for (const line of lines.slice(0, 10)) {
    const fnMatch = line.match(
      /(?:export\s+)?(?:async\s+)?(?:function|const|class|def|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION)\s+(\w+)/i,
    );
    if (fnMatch) {
      return `${language} ${fnMatch[1]}() — ${lines.length} line${lines.length === 1 ? '' : 's'}`;
    }
  }

  // Fallback: first meaningful line truncated
  const firstMeaningful = lines.find((l) => l.trim().length > 0) ?? lines[0];
  const truncated =
    firstMeaningful.length > 80 ? firstMeaningful.slice(0, 77) + '...' : firstMeaningful;
  return `${language}: ${truncated}`;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** @deprecated Tier gating removed — all users get full brain. Kept for reference. */
function tierHierarchy(tier: ManifestTier): Set<ManifestTier> {
  switch (tier) {
    case 'essential':
      return new Set<ManifestTier>(['essential']);
    case 'standard':
      return new Set<ManifestTier>(['essential', 'standard']);
    case 'premium':
      return new Set<ManifestTier>(['essential', 'standard', 'premium']);
  }
}

// ---------------------------------------------------------------------------
// Registry — CORE_MANIFEST
// ---------------------------------------------------------------------------

export const CORE_MANIFEST: readonly ManifestEntry[] = [
  // =========================================================================
  // SLASH SKILLS — Essential (14)
  // =========================================================================
  {
    path: 'skills/build/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.3.0',
    description:
      'Execute projects end-to-end with full lifecycle — structured QA, PR documentation, closing gates',
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
    version: '1.2.0',
    description: 'Create full projects with structured briefs, ordered tasks, and closing gates',
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
    version: '1.2.0',
    description: 'End-of-session ritual with memory persistence (layered architecture)',
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
    path: 'skills/git-branch/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description: 'Create branches with merged-branch safety check',
    isCore: true,
    integrationGroup: 'github',
  },
  {
    path: 'skills/git-push/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.1.0',
    description: 'Push to branch and create PR',
    isCore: true,
    integrationGroup: 'github',
  },
  {
    path: 'skills/git-deploy/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.1.0',
    description: 'Full deploy pipeline (PR, CI, merge)',
    isCore: true,
    integrationGroup: 'github',
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
    version: '1.1.0',
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

  // Design Skills Library (22 commands + home)
  {
    path: 'skills/design/CLAUDE.md',
    tier: 'essential',
    category: 'skill',
    version: '1.0.0',
    description:
      'Design fluency for AI harnesses — 22 commands, 7 reference dimensions, anti-pattern detector',
    isCore: true,
  },

  // =========================================================================
  // SLASH SKILLS — Standard (11)
  // =========================================================================
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
    version: '1.3.0',
    description:
      'Research project lifecycle — structured briefs, ordered task tables, Q&A to deliverable',
    isCore: true,
  },
  {
    path: 'skills/auto-approve/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.1.0',
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
    integrationGroup: 'slack',
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
    version: '1.1.0',
    description: 'Autonomous platform feature building (layered architecture)',
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
    version: '1.1.0',
    description: 'Autonomous backlog grooming',
    isCore: true,
  },
  {
    path: 'skills/afk-blogging/CLAUDE.md',
    tier: 'standard',
    category: 'skill',
    version: '1.0.0',
    description: 'Overnight blog post creation for SEO and thought leadership',
    isCore: true,
  },

  // =========================================================================
  // PROTOCOL SKILLS (not slash commands — in .claude/skills/)
  // =========================================================================
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
    version: '1.1.0',
    description: 'Parallel agent isolation via git worktrees',
    isCore: true,
    integrationGroup: 'github',
  },

  // =========================================================================
  // HOOKS
  // =========================================================================
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
    integrationGroup: 'slack',
  },
  {
    path: 'hooks/pre-compact.sh',
    tier: 'essential',
    category: 'hook',
    version: '1.0.0',
    description: 'Pre-compaction state capture for recovery',
    isCore: true,
  },
  {
    path: 'hooks/post-compact.sh',
    tier: 'essential',
    category: 'hook',
    version: '1.0.0',
    description: 'Post-compaction context restoration',
    isCore: true,
  },

  // =========================================================================
  // AGENTS
  // =========================================================================
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

  // =========================================================================
  // AGENT DOCS
  // =========================================================================
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
    integrationGroup: 'github',
  },
  {
    path: 'agent_docs/worktree-quick-ref.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Quick reference for worktree commands',
    isCore: true,
    integrationGroup: 'github',
  },
  {
    path: 'agent_docs/WORKTREE-SUMMARY.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Worktree architecture summary',
    isCore: true,
    integrationGroup: 'github',
  },
  {
    path: 'agent_docs/WORKTREE-VISUAL-GUIDE.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Visual guide for worktree patterns',
    isCore: true,
    integrationGroup: 'github',
  },
  {
    path: 'agent_docs/TMUX-WORKTREE-SETUP.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'tmux + worktree setup guide',
    isCore: true,
    integrationGroup: 'github',
  },
  {
    path: 'agent_docs/error-metrics.md',
    tier: 'standard',
    category: 'agent_doc',
    version: '1.0.0',
    description: 'Error tracking and metrics for Code Reviewer',
    isCore: true,
  },

  // =========================================================================
  // SETTINGS & CONFIG
  // =========================================================================
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

  // =========================================================================
  // SETTINGS — Heartbeat
  // =========================================================================
  {
    path: 'settings/heartbeat-config',
    tier: 'essential',
    category: 'settings',
    version: '1.0.0',
    description: 'Default heartbeat monitoring configuration for agent health',
    isCore: true,
  },

  // =========================================================================
  // MEMORY SYSTEM
  // =========================================================================
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

  // =========================================================================
  // DELEGATION PROTOCOL
  // =========================================================================
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
] as const;

// ---------------------------------------------------------------------------
// Counts (compile-time sanity check via comments)
// ---------------------------------------------------------------------------
// Skills:     16 essential (13 slash + 2 protocol + 1 security-audit) + 13 standard (11 slash + 3 protocol) = 29
// Hooks:      5 essential + 1 standard + 1 premium = 7
// Agents:     2 essential + 3 standard = 5
// Agent Docs: 4 essential + 6 standard = 10
// Settings:   7 essential = 7
// Memory:     3 essential = 3
// Delegation: 1 essential + 3 standard = 4
// TOTAL:      65 entries
