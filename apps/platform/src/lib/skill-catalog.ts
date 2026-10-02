/**
 * Skill Catalog Registry
 *
 * User-facing metadata for skills and automated workflows.
 * Built on top of the brain-manifest-registry, this enriches
 * manifest entries with display names, categories, and trigger info.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Hammer,
  FolderKanban,
  ListTodo,
  RefreshCw,
  Save,
  Moon,
  Calendar,
  GitBranch,
  Rocket,
  Minimize2,
  Search,
  FileText,
  Shield,
  Wrench,
  Zap,
  MessageSquare,
  Brain,
  Bot,
  Bug,
  Layers,
  TestTubeDiagonal,
  Code2,
  GitPullRequest,
  Play,
  Terminal,
  FileCode,
  Trash2,
  Lightbulb,
  Megaphone,
  Mail,
  TrendingUp,
  BarChart3,
  Target,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillTrigger = 'slash' | 'auto' | 'protocol';

export type SkillCategory =
  | 'autonomous'
  | 'project-management'
  | 'git-workflows'
  | 'code-quality'
  | 'session-management'
  | 'research'
  | 'integrations'
  | 'marketing';

export type SkillTier = 'essential' | 'standard' | 'premium';

export interface SkillCatalogEntry {
  /** Slash command name (e.g. "/build") or display name for auto/protocol */
  command: string;
  /** Human-readable title */
  title: string;
  /** One-line description */
  description: string;
  /** Extended description for the detail drawer */
  details: string;
  /** How the skill is triggered */
  trigger: SkillTrigger;
  /** High-level category for grouping */
  category: SkillCategory;
  /** Plan tier: essential (Builder), standard (Pro), premium (Unlimited) */
  tier: SkillTier;
  /** Icon component */
  icon: LucideIcon;
  /** Manifest path (links to brain_manifest entry) */
  manifestPath: string;
  /** Integration requirement (null = always available) */
  integration: string | null;
  /** Example usage */
  example: string | null;
}

/**
 * Map plan feature flags to allowed skill tiers.
 * - essential_skills → essential only (Builder)
 * - standard_skills → essential + standard (Pro)
 * - all_skills → essential + standard + premium (Unlimited)
 */
export function getAllowedSkillTiers(features: string[]): Set<SkillTier> {
  if (features.includes('all_skills')) return new Set(['essential', 'standard', 'premium']);
  if (features.includes('standard_skills')) return new Set(['essential', 'standard']);
  return new Set(['essential']);
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

export const CATEGORY_META: Record<
  SkillCategory,
  { label: string; description: string; icon: LucideIcon }
> = {
  autonomous: {
    label: 'Autonomous',
    description: 'Skills that run independently overnight or in the background',
    icon: Bot,
  },
  'project-management': {
    label: 'Project Management',
    description: 'Create and manage projects, tasks, and sprints',
    icon: FolderKanban,
  },
  'git-workflows': {
    label: 'Git Workflows',
    description: 'Version control, PRs, and deployment automation',
    icon: GitBranch,
  },
  'code-quality': {
    label: 'Code Quality',
    description: 'Testing, debugging, and code review protocols',
    icon: Shield,
  },
  'session-management': {
    label: 'Session Management',
    description: 'Memory, context, and session lifecycle',
    icon: Save,
  },
  research: {
    label: 'Research',
    description: 'Deep research, analysis, and knowledge organization',
    icon: Search,
  },
  integrations: {
    label: 'Integrations',
    description: 'Third-party service connections and hooks',
    icon: Zap,
  },
  marketing: {
    label: 'Marketing',
    description: 'Campaign planning, content strategy, and growth tools',
    icon: Megaphone,
  },
};

// ---------------------------------------------------------------------------
// Trigger metadata
// ---------------------------------------------------------------------------

export const TRIGGER_META: Record<SkillTrigger, { label: string; description: string }> = {
  slash: {
    label: 'Slash Command',
    description: 'Invoked with /<command> in the CLI',
  },
  auto: {
    label: 'Automated',
    description: 'Triggered automatically by hooks or events',
  },
  protocol: {
    label: 'Protocol',
    description: 'Internal protocol used by agents automatically',
  },
};

// ---------------------------------------------------------------------------
// Catalog entries — Slash Commands
// ---------------------------------------------------------------------------

export const SKILL_CATALOG: readonly SkillCatalogEntry[] = [
  // ── Project Management ─────────────────────────────────────────────────
  {
    command: '/build',
    tier: 'essential',
    title: 'Build',
    description: 'Execute projects end-to-end with full lifecycle',
    details:
      'Takes a project or task UUID, validates readiness (PRD, closing tasks, descriptions), selects orchestration mode (solo, sub-agents, or agent team), and executes all sprints through delivery. Includes code review, design feedback, and retrospective.',
    trigger: 'slash',
    category: 'project-management',
    icon: Hammer,
    manifestPath: 'skills/build/CLAUDE.md',
    integration: null,
    example: '/build a5d70596-8a3b-4236-8876-afc4ff86e232',
  },
  {
    command: '/project',
    tier: 'essential',
    title: 'Project',
    description: 'Create full projects with grouped tasks',
    details:
      'Deep-researches a topic, creates a Supabase project with PRD, and populates it with detailed, sequenced tasks. Supports YouTube URLs, web URLs, codebase areas, and initiative names.',
    trigger: 'slash',
    category: 'project-management',
    icon: FolderKanban,
    manifestPath: 'skills/project/CLAUDE.md',
    integration: null,
    example: '/project platform security hardening',
  },
  {
    command: '/project-plan',
    tier: 'standard',
    title: 'Project Plan',
    description: 'Plan project with full quality gates',
    details:
      'Creates a plan-type project using the full project lifecycle: research, PRD drafting (SAGE + DELV), R&D review (NOIR + SCAN), task creation with structured descriptions, and closing gates (Code Review → Design Feedback → Retro). Ideal for roadmaps, sprint planning, and non-code initiatives that still deserve quality gates.',
    trigger: 'slash',
    category: 'project-management',
    icon: FileText,
    manifestPath: 'skills/project-plan/CLAUDE.md',
    integration: null,
    example: '/project-plan Q2 roadmap',
  },
  {
    command: '/task',
    tier: 'essential',
    title: 'Task',
    description: 'Create inbox tasks from analysis',
    details:
      'Creates structured Supabase tasks with rich descriptions (What/Value/Approach/Sequence/Blockers). Supports batch creation and automatic categorization.',
    trigger: 'slash',
    category: 'project-management',
    icon: ListTodo,
    manifestPath: 'skills/task/CLAUDE.md',
    integration: null,
    example: '/task fix the login redirect bug',
  },
  {
    command: '/todays-project',
    tier: 'essential',
    title: "Today's Project",
    description: 'Daily prioritized task list from Supabase',
    details:
      'Pulls your current tasks, prioritizes them by urgency and dependencies, and presents a focused work plan for the day.',
    trigger: 'slash',
    category: 'project-management',
    icon: Calendar,
    manifestPath: 'skills/todays-project/CLAUDE.md',
    integration: null,
    example: '/todays-project',
  },

  // ── Autonomous ─────────────────────────────────────────────────────────
  {
    command: '/afk-building',
    tier: 'premium',
    title: 'AFK Building',
    description: 'Autonomous platform feature building',
    details:
      'Platform engineering build mode. Picks product tasks from the Planned column in optimal build sequence, writes RFCs, delegates to sub-agents, and produces detailed completion reports. Runs unattended until timeout.',
    trigger: 'slash',
    category: 'autonomous',
    icon: Hammer,
    manifestPath: 'skills/afk-building/CLAUDE.md',
    integration: null,
    example: '/afk-building timeout=4h',
  },
  {
    command: '/afk-overnight',
    tier: 'premium',
    title: 'AFK Nightwatch',
    description: 'Overnight autonomous task execution and research',
    details:
      'Autonomous overnight mode that combines task execution with deep research. Works through planned tasks first using the full build lifecycle (RFC, implement, verify), then switches to research mode — scanning for opportunities, competitive analysis, and knowledge gathering. Includes stop conditions, sentinel-based coordination, and detailed completion reports for morning review.',
    trigger: 'slash',
    category: 'autonomous',
    icon: Moon,
    manifestPath: 'skills/afk-overnight/CLAUDE.md',
    integration: null,
    example: '/afk-overnight',
  },
  {
    command: '/afk-housekeeping',
    tier: 'premium',
    title: 'AFK Housekeeping',
    description: 'Autonomous cleanup for backlog tasks',
    details:
      'Works through small, well-defined tasks from the backlog autonomously. Targets tech debt, code quality fixes, stale TODOs, and routine maintenance. Creates a dedicated branch and PR with full QA (code review, design feedback, retro) — housekeeping gets the same rigor as features. Runs with a configurable timeout and produces completion reports.',
    trigger: 'slash',
    category: 'autonomous',
    icon: Trash2,
    manifestPath: 'skills/afk-housekeeping/CLAUDE.md',
    integration: null,
    example: '/afk-housekeeping',
  },
  {
    command: '/afk-planning',
    tier: 'premium',
    title: 'AFK Planning',
    description: 'Autonomous backlog grooming and opportunity research',
    details:
      'Runs a full planning cycle: triages inbox tasks, calibrates priorities against current goals, identifies gaps in the roadmap, and researches new project opportunities using web search and competitive analysis. Can create new projects with PRDs and sequenced tasks. Produces a planning summary with recommendations for the next sprint.',
    trigger: 'slash',
    category: 'autonomous',
    icon: Lightbulb,
    manifestPath: 'skills/afk-planning/CLAUDE.md',
    integration: null,
    example: '/afk-planning find 3 new project opportunities',
  },
  {
    command: '/deep-build',
    tier: 'premium',
    title: 'Deep Build',
    description: 'Iterative build-verify loop for complex tasks',
    details:
      'Enhanced build mode for effort=L/XL tasks where correctness matters more than speed. Runs an iterative cycle: implement a chunk → type-check → build → test → review → fix → repeat until all checks pass cleanly. Each iteration narrows scope to remaining issues. Produces a detailed verification report showing each pass and what was fixed.',
    trigger: 'slash',
    category: 'autonomous',
    icon: Layers,
    manifestPath: 'skills/deep-build/CLAUDE.md',
    integration: null,
    example: '/deep-build auth-middleware-rewrite',
  },
  {
    command: '/auto-approve',
    tier: 'standard',
    title: 'Auto Approve',
    description: 'Autonomous execution mode with guardrails',
    details:
      'Enables autonomous execution where RICK self-reviews PRs targeting non-main branches. Main branch PRs always require human approval.',
    trigger: 'slash',
    category: 'autonomous',
    icon: Zap,
    manifestPath: 'skills/auto-approve/CLAUDE.md',
    integration: null,
    example: '/auto-approve',
  },

  // ── Git Workflows ──────────────────────────────────────────────────────
  {
    command: '/git-branch',
    tier: 'essential',
    title: 'Git Branch',
    description: 'Create branches with safety checks',
    details:
      'Creates new branches with merged-branch safety checks. Prevents branching from already-merged branches (which causes duplicate commits and merge conflicts). Always validates the base branch before creation.',
    trigger: 'slash',
    category: 'git-workflows',
    icon: GitBranch,
    manifestPath: 'skills/git-branch/CLAUDE.md',
    integration: 'github',
    example: '/git-branch my-feature --from main',
  },
  {
    command: '/git-push',
    tier: 'essential',
    title: 'Git Push',
    description: 'Push to branch and create PR',
    details:
      'Pushes your current branch to the remote and optionally creates a pull request with a structured description.',
    trigger: 'slash',
    category: 'git-workflows',
    icon: GitBranch,
    manifestPath: 'skills/git-push/CLAUDE.md',
    integration: 'github',
    example: '/git-push',
  },
  {
    command: '/git-deploy',
    tier: 'standard',
    title: 'Git Deploy',
    description: 'Full deploy pipeline (PR, CI, merge)',
    details:
      'Complete deployment workflow: creates PR, waits for CI, handles review, and merges. Includes Vercel deployment verification.',
    trigger: 'slash',
    category: 'git-workflows',
    icon: Rocket,
    manifestPath: 'skills/git-deploy/CLAUDE.md',
    integration: 'github',
    example: '/git-deploy',
  },

  // ── Code Quality ───────────────────────────────────────────────────────
  {
    command: '/security-audit',
    tier: 'premium',
    title: 'Security Audit',
    description: 'Full security scan with task creation',
    details:
      'Comprehensive security audit covering OWASP top 10, auth patterns, RLS policies, input validation, and service key isolation. Creates tasks for each finding.',
    trigger: 'slash',
    category: 'code-quality',
    icon: Shield,
    manifestPath: 'skills/security-audit/CLAUDE.md',
    integration: null,
    example: '/security-audit',
  },

  // ── Session Management ─────────────────────────────────────────────────
  {
    command: '/closing-time',
    tier: 'standard',
    title: 'Closing Time',
    description: 'End-of-session ritual with memory persistence',
    details:
      'Saves session context, syncs tasks, writes session log, updates memory, and optionally chains into an overnight AFK skill.',
    trigger: 'slash',
    category: 'session-management',
    icon: Moon,
    manifestPath: 'skills/closing-time/CLAUDE.md',
    integration: null,
    example: '/closing-time run /afk-building tonight',
  },
  {
    command: '/refresh',
    tier: 'essential',
    title: 'Refresh',
    description: 'Re-sync workspace context',
    details:
      "Refreshes the agent's workspace context by re-reading CLAUDE.md files, task board state, and active project context.",
    trigger: 'slash',
    category: 'session-management',
    icon: RefreshCw,
    manifestPath: 'skills/refresh/CLAUDE.md',
    integration: null,
    example: '/refresh',
  },
  {
    command: '/quick-flush',
    tier: 'essential',
    title: 'Quick Flush',
    description: 'Mid-session memory save',
    details:
      'Saves important context from the current session to persistent memory without ending the session.',
    trigger: 'slash',
    category: 'session-management',
    icon: Save,
    manifestPath: 'skills/quick-flush/CLAUDE.md',
    integration: null,
    example: '/quick-flush',
  },
  {
    command: '/lean',
    tier: 'essential',
    title: 'Lean Mode',
    description: 'Minimal context mode for performance',
    details:
      'Strips down context loading to the bare minimum for faster responses. Ideal for quick fixes and small tasks.',
    trigger: 'slash',
    category: 'session-management',
    icon: Minimize2,
    manifestPath: 'skills/lean/CLAUDE.md',
    integration: null,
    example: '/lean',
  },

  // ── Research ───────────────────────────────────────────────────────────
  {
    command: '/research',
    tier: 'standard',
    title: 'Research',
    description: 'Deep market and technical research',
    details:
      'Conducts thorough research using web search, content analysis, and competitive landscape mapping. Produces structured findings.',
    trigger: 'slash',
    category: 'research',
    icon: Search,
    manifestPath: 'skills/research/CLAUDE.md',
    integration: null,
    example: '/research AI agent frameworks 2026',
  },
  {
    command: '/project-research',
    tier: 'standard',
    title: 'Research Project',
    description: 'Research project lifecycle (Q&A to deliverable)',
    details:
      'Creates a research-type project with Q&A intake, research tasks, and a final research deliverable. No PRD or code review needed.',
    trigger: 'slash',
    category: 'research',
    icon: FileText,
    manifestPath: 'skills/project-research/CLAUDE.md',
    integration: null,
    example: '/project-research competitive analysis of task tools',
  },
  {
    command: '/brain',
    tier: 'premium',
    title: 'Brain',
    description: 'PARA knowledge organization and semantic search',
    details:
      'Manages your second brain using the PARA method. Search, organize, and retrieve knowledge from your vault.',
    trigger: 'slash',
    category: 'research',
    icon: Brain,
    manifestPath: 'skills/brain/CLAUDE.md',
    integration: null,
    example: '/brain search agent architecture',
  },

  // ── Integrations ───────────────────────────────────────────────────────
  {
    command: '/slack',
    tier: 'premium',
    title: 'Slack',
    description: 'Pull Slack context before responding',
    details:
      "Fetches relevant Slack messages and threads to inform the agent's response. Useful for getting context from team discussions.",
    trigger: 'slash',
    category: 'integrations',
    icon: MessageSquare,
    manifestPath: 'skills/slack/CLAUDE.md',
    integration: 'slack',
    example: '/slack check #engineering for context',
  },

  // ── Automated Workflows (Hooks) ────────────────────────────────────────
  {
    command: 'session-start',
    tier: 'essential',
    title: 'Session Start',
    description: 'CLI-to-platform bridge on session start',
    details:
      'Runs automatically when a Claude Code session starts. Syncs workspace context, loads active project, and establishes the platform connection.',
    trigger: 'auto',
    category: 'session-management',
    icon: Play,
    manifestPath: 'hooks/session-start.sh',
    integration: null,
    example: null,
  },
  {
    command: 'auto-format',
    tier: 'essential',
    title: 'Auto Format',
    description: 'Prettier on Write/Edit tool use',
    details:
      'Automatically runs Prettier formatting whenever a file is written or edited. Ensures consistent code style without manual intervention.',
    trigger: 'auto',
    category: 'code-quality',
    icon: FileCode,
    manifestPath: 'hooks/auto-format.sh',
    integration: null,
    example: null,
  },
  {
    command: 'dependency-verification',
    tier: 'standard',
    title: 'Dependency Verification',
    description: 'Verify dependencies before install (toggleable)',
    details:
      'Checks dependency integrity before npm/pnpm install operations. Can be toggled on/off per workspace.',
    trigger: 'auto',
    category: 'code-quality',
    icon: Shield,
    manifestPath: 'hooks/dependency-verification.sh',
    integration: null,
    example: null,
  },
  {
    command: 'tdd-enforcement',
    tier: 'standard',
    title: 'TDD Enforcement',
    description: 'Advisory warning, pairs with TDD skill',
    details:
      'Shows an advisory warning when code is written without corresponding tests. Works alongside the TDD protocol skill.',
    trigger: 'auto',
    category: 'code-quality',
    icon: TestTubeDiagonal,
    manifestPath: 'hooks/tdd-enforcement.sh',
    integration: null,
    example: null,
  },
  {
    command: 'pre-compact',
    tier: 'premium',
    title: 'Pre-Compact',
    description: 'Pre-compaction state capture for recovery',
    details:
      'Captures session state before context compaction occurs. Enables recovery of important context that might otherwise be lost.',
    trigger: 'auto',
    category: 'session-management',
    icon: Save,
    manifestPath: 'hooks/pre-compact.sh',
    integration: null,
    example: null,
  },
  {
    command: 'post-compact',
    tier: 'premium',
    title: 'Post-Compact',
    description: 'Post-compaction context restoration',
    details:
      'Restores critical context after compaction. Ensures the agent maintains continuity across long sessions.',
    trigger: 'auto',
    category: 'session-management',
    icon: RefreshCw,
    manifestPath: 'hooks/post-compact.sh',
    integration: null,
    example: null,
  },
  {
    command: 'slack-translator',
    tier: 'premium',
    title: 'Slack Translator',
    description: 'Enterprise Slack integration hook',
    details:
      'Translates Slack events into platform actions. Enables bi-directional communication between Slack and the agent system.',
    trigger: 'auto',
    category: 'integrations',
    icon: MessageSquare,
    manifestPath: 'hooks/slack-translator.sh',
    integration: 'slack',
    example: null,
  },

  // ── Protocol Skills (Internal) ─────────────────────────────────────────
  {
    command: 'debugging',
    tier: 'essential',
    title: 'Debugging Protocol',
    description: '4-phase debugging protocol, stack-specific',
    details:
      "Systematic debugging approach: Reproduce → Isolate → Fix → Verify. Adapts to the project's tech stack automatically.",
    trigger: 'protocol',
    category: 'code-quality',
    icon: Bug,
    manifestPath: 'skills/debugging/CLAUDE.md',
    integration: null,
    example: null,
  },
  {
    command: 'context-management',
    tier: 'essential',
    title: 'Context Management',
    description: 'Session degradation prevention',
    details:
      'Monitors context window usage and proactively compacts or delegates to prevent session degradation in long-running work.',
    trigger: 'protocol',
    category: 'session-management',
    icon: Terminal,
    manifestPath: 'skills/context-management/CLAUDE.md',
    integration: null,
    example: null,
  },
  {
    command: 'tdd',
    tier: 'standard',
    title: 'TDD Protocol',
    description: 'Red-green-refactor enforcement protocol',
    details:
      'Enforces test-driven development: write a failing test first, make it pass, then refactor. Ensures comprehensive test coverage.',
    trigger: 'protocol',
    category: 'code-quality',
    icon: TestTubeDiagonal,
    manifestPath: 'skills/tdd/CLAUDE.md',
    integration: null,
    example: null,
  },
  {
    command: 'code-review',
    tier: 'standard',
    title: 'Code Review Protocol',
    description: 'Quality checklist with quick and full modes',
    details:
      'Structured code review protocol with two modes: quick (security + correctness) and full (security + correctness + style + architecture).',
    trigger: 'protocol',
    category: 'code-quality',
    icon: Code2,
    manifestPath: 'skills/code-review/CLAUDE.md',
    integration: null,
    example: null,
  },
  {
    command: 'worktree-workflow',
    tier: 'premium',
    title: 'Worktree Workflow',
    description: 'Parallel agent isolation via git worktrees',
    details:
      'Protocol for running multiple agents in parallel using git worktrees. Each agent works in an isolated copy of the repo.',
    trigger: 'protocol',
    category: 'git-workflows',
    icon: GitPullRequest,
    manifestPath: 'skills/worktree-workflow/CLAUDE.md',
    integration: 'github',
    example: null,
  },
  // ── Marketing ────────────────────────────────────────────────────────
  {
    command: '/campaign-planner',
    title: 'Campaign Planner',
    description:
      'Generate multi-channel campaign briefs with budget allocation, timeline, and KPIs.',
    details:
      'Creates structured campaign plans across paid, organic, email, and social channels. Includes audience targeting, creative direction, budget split recommendations, and success metrics. Outputs a ready-to-execute brief.',
    trigger: 'slash',
    category: 'marketing',
    tier: 'essential',
    icon: Megaphone,
    manifestPath: 'skills/campaign-planner/CLAUDE.md',
    integration: null,
    example: '/campaign-planner Launch campaign for new feature release targeting enterprise users',
  },
  {
    command: '/email-drafter',
    title: 'Email Sequence Drafter',
    description: 'Write email nurture sequences — welcome, onboarding, re-engagement, and sales.',
    details:
      'Generates complete email sequences with subject lines, body copy, CTAs, and send timing. Supports welcome series, onboarding drips, win-back campaigns, and sales outreach. Maintains brand voice consistency across the sequence.',
    trigger: 'slash',
    category: 'marketing',
    tier: 'essential',
    icon: Mail,
    manifestPath: 'skills/email-drafter/CLAUDE.md',
    integration: null,
    example: '/email-drafter 5-email welcome sequence for new SaaS trial users',
  },
  {
    command: '/growth-experiment',
    title: 'Growth Experiment Designer',
    description:
      'Create A/B test hypotheses, experiment plans with control, variant, and success metrics.',
    details:
      'Structures growth experiments using the hypothesis → test → measure framework. Defines control and variant, sample size estimates, primary and secondary metrics, expected lift, and statistical significance thresholds. Tracks experiment history.',
    trigger: 'slash',
    category: 'marketing',
    tier: 'essential',
    icon: TrendingUp,
    manifestPath: 'skills/growth-experiment/CLAUDE.md',
    integration: null,
    example:
      '/growth-experiment Test whether adding social proof to pricing page increases conversion',
  },
  {
    command: '/content-calendar',
    title: 'Content Calendar',
    description: 'Build weekly or monthly content calendars across channels.',
    details:
      'Generates content calendars with topic suggestions, channel assignments, posting schedule, and content type mix. Balances educational, promotional, and engagement content. Supports blog, social, email, and video channels.',
    trigger: 'slash',
    category: 'marketing',
    tier: 'essential',
    icon: Calendar,
    manifestPath: 'skills/content-calendar/CLAUDE.md',
    integration: null,
    example: '/content-calendar Monthly content plan for B2B SaaS blog + LinkedIn + newsletter',
  },
  {
    command: '/competitor-tracker',
    title: 'Competitor Tracker',
    description: 'Structured competitive analysis with positioning matrix and feature comparison.',
    details:
      'Conducts systematic competitive analysis: feature comparison matrix, pricing analysis, positioning map, SWOT per competitor, and strategic recommendations. Identifies gaps and differentiation opportunities.',
    trigger: 'slash',
    category: 'marketing',
    tier: 'standard',
    icon: Target,
    manifestPath: 'skills/competitor-tracker/CLAUDE.md',
    integration: null,
    example: '/competitor-tracker Analyze top 5 competitors in the AI coding assistant space',
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get all skills of a specific trigger type */
export function getSkillsByTrigger(trigger: SkillTrigger): SkillCatalogEntry[] {
  return SKILL_CATALOG.filter((s) => s.trigger === trigger);
}

/** Get all skills in a specific category */
export function getSkillsByCategory(category: SkillCategory): SkillCatalogEntry[] {
  return SKILL_CATALOG.filter((s) => s.category === category);
}

/** Get all unique categories that have skills */
export function getActiveCategories(): SkillCategory[] {
  return [...new Set(SKILL_CATALOG.map((s) => s.category))];
}
