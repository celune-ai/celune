import { createServiceClient } from '@repo/db/service';
import { getRoleMemories, getTemplateMemories } from '@repo/db/team-memories';

// ── Types ────────────────────────────────────────────────────────────────────

export type IntegrationGroup = 'github' | 'slack' | 'voice' | 'byok';

export interface SeedMemory {
  key: string;
  content: string;
  category: 'preference' | 'decision' | 'context' | 'fact' | 'general';
  memory_type: 'fact' | 'preference' | 'decision' | 'context';
  importance_score: number;
  /** null = core (always seeded), string = gated to that integration */
  integration: IntegrationGroup | null;
  /** null = system-level, string = specific agent */
  agent_id: string | null;
}

// ── Core Knowledge Pack (Always Seeded) ──────────────────────────────────────

export const CORE_KNOWLEDGE: SeedMemory[] = [
  {
    key: 'workflow:task-discipline',
    content:
      'Always create a task before starting any piece of work — even small fixes. Tasks are the universal unit of work. They connect effort to outcomes, create a paper trail, and keep the board accurate. Create the task BEFORE starting, not after.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 95,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:task-lifecycle',
    content:
      'Tasks follow a claim-and-complete lifecycle. Claim a task when you start working on it. Complete it when the work is delivered and verified. The task board must always reflect real-time state — no stale claims, no batch updates after the fact.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 93,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:structured-descriptions',
    content:
      'Task descriptions use a structured format with at minimum two sections: "## What" (what needs to be done and why) and "## Approach" (step-by-step plan). Adapt sections to the task type — add ## Blockers, ## Value, ## Sequence as needed. This structure makes tasks actionable without additional context.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 88,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:task-titles',
    content:
      'Task titles should be 70 characters or less. Use concise, imperative phrasing. Move detail to the description. Good: "Add user avatar upload to settings". Bad: "We need to implement the ability for users to upload and manage their profile avatars in the settings page".',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 80,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:project-lifecycle',
    content:
      'Projects follow a structured lifecycle: PRD (requirements) → Implementation tasks → Code Review → Design Feedback → Retrospective. Each phase builds on the previous. Implementation tasks are grouped into sprints by dependency order. Closing tasks (CR, DF, Retro) run sequentially after all implementation is done.',
    category: 'context',
    memory_type: 'context',
    importance_score: 90,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:quality-gates',
    content:
      'Run verification before marking work complete: type-check, tests, build, and format check. QA happens BEFORE creating a PR, not after. Code review findings are auto-converted into fix tasks that get resolved before proceeding to retro.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 90,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:context-management',
    content:
      'Use /closing-time at the end of every session to save context and create handoff notes. Use /quick-flush mid-session when context is growing large. These rituals prevent context loss during compaction and ensure continuity across sessions.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 85,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:agent-delegation',
    content:
      'Three delegation modes: Solo (direct execution, 1-5 tasks), Sub-agents (parallel workers for 6-8 tasks), Agent Team (full orchestration for 9+ tasks). The lead agent codes directly — delegation is for parallelism, not hierarchy. Use cheaper models for bounded tasks (Haiku for research, Sonnet for reviews).',
    category: 'context',
    memory_type: 'context',
    importance_score: 85,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:skill-usage',
    content:
      'Key skills: /build executes a project end-to-end. /task creates a single task. /project creates a multi-task project with PRD. /todays-project shows your prioritized daily plan. /research does deep market research. /security-audit audits the codebase. Match the skill to the scope of work.',
    category: 'context',
    memory_type: 'context',
    importance_score: 82,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:every-work-gets-task',
    content:
      'Every piece of work gets a task — even small fixes, tab changes, or bug fixes. Tasks tie productivity to cost, create a paper trail, and maintain board hygiene. All tasks start as "inbox" status. The /build skill moves them through the pipeline.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 92,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:plan-before-code',
    content:
      'When receiving a plan or implementation request, first break it into tasks (one per logical change), then work each task sequentially: create → claim → implement → complete. Do not treat plan steps as a mental checklist — they must become real tasks on the board.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 94,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:retro-action-items',
    content:
      'Every project retrospective produces action items. Each action item becomes a real task in the system. Retro findings feed into the next project cycle — improving skills, fixing recurring issues, and capturing lessons learned.',
    category: 'context',
    memory_type: 'context',
    importance_score: 78,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:agent-handoff',
    content:
      'When delegating a task to a sub-agent or team member, reassign the task to that agent so the board shows who is actually working it. The board must reflect real-time ownership. Claim at handoff, complete on delivery.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 83,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:memory-categories',
    content:
      'Memories have four categories: "preference" (how you want things done), "decision" (choices that should persist), "context" (background knowledge), "fact" (stable truths). Use the right category so agents can recall the right memories at the right time.',
    category: 'context',
    memory_type: 'context',
    importance_score: 78,
    integration: null,
    agent_id: null,
  },
  {
    key: 'workflow:no-over-engineering',
    content:
      'Build what is needed now, not what might be needed later. Only make changes that are directly requested or clearly necessary. Three similar lines of code are better than a premature abstraction. Do not add features, refactor code, or make improvements beyond what was asked.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 88,
    integration: null,
    agent_id: null,
  },
];

// ── GitHub Integration Pack ──────────────────────────────────────────────────

export const GITHUB_PACK: SeedMemory[] = [
  {
    key: 'github:branch-policy',
    content:
      'One branch per project. All tasks in a project go on the same branch. Before starting work, check for existing unmerged branches. Ask before creating a new branch — present what exists and whether the work should go on an existing branch or a new one.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 90,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:pr-format',
    content:
      'PR body should include: Summary (bullet points of changes), Test Plan (checklist), and Verification table (pass/fail for type-check, tests, lint, build). Always run QA before creating the PR, not after.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 88,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:qa-before-pr',
    content:
      'Full QA sequence BEFORE creating a PR: 1) Run local verification (type-check, tests, format-check). 2) Run code review, design feedback, and security review. 3) Fix all critical/high findings. 4) Create PR with all findings documented. 5) Wait for CI checks to pass.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 92,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:commit-conventions',
    content:
      'Commits should be atomic — one logical change per commit. Use clear, descriptive messages. Never skip pre-commit hooks (--no-verify) or bypass signing. Never force-push to shared branches. Create new commits rather than amending existing ones when fixing issues.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 85,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:worktree-patterns',
    content:
      'When sub-agents work in parallel, use git worktrees for isolation. After sub-agent worktrees complete, merge their changes into the project branch immediately. Delete the worktree branch. Never leave stale worktree branches dangling.',
    category: 'context',
    memory_type: 'context',
    importance_score: 80,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:code-review-process',
    content:
      'Code review produces a structured document with automated results (type-check, tests, lint) and manual findings (security, quality, architecture). Each finding is auto-converted into a fix task. All fix tasks are resolved before proceeding. Review comments are posted on the PR.',
    category: 'context',
    memory_type: 'context',
    importance_score: 85,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:no-orphan-branches',
    content:
      'Every local branch must either be pushed to a PR or deleted. Stale local branches create lost context and merge conflicts. Clean up after each project or sprint.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 78,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:draft-pr-workflow',
    content:
      'For large projects, create a draft PR early so CI runs on every push. Convert to ready-for-review after all implementation and QA is complete. This gives early feedback on integration issues.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 75,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:merge-conflicts',
    content:
      'Resolve merge conflicts rather than discarding changes. If a lock file exists, investigate what process holds it rather than deleting it. Never use destructive git operations (reset --hard, checkout .) as a shortcut — investigate root causes.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 82,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:ci-before-merge',
    content:
      'Never merge with failing CI checks. All checks (type-check, tests, lint, build) must pass before merge. If a check fails, fix the issue locally, push, and verify — do not bypass.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 88,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:force-push-policy',
    content:
      'Never force-push to main or shared branches. Force-push can overwrite upstream work and is hard to recover from. Only force-push to your own feature branches when explicitly needed, and always warn first.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 90,
    integration: 'github',
    agent_id: null,
  },
  {
    key: 'github:pr-reviewer-assignment',
    content:
      'PRs targeting main always require human review. PRs targeting feature branches can be self-reviewed in auto-approve mode. Always add a reviewer — never merge without at least one approval.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 83,
    integration: 'github',
    agent_id: null,
  },
];

// ── Slack Integration Pack ───────────────────────────────────────────────────

export const SLACK_PACK: SeedMemory[] = [
  {
    key: 'slack:channel-conventions',
    content:
      'Use dedicated channels for agent notifications: #tasks for task updates, #builds for build progress, #reviews for code review results. Keep channels focused — avoid noisy all-in-one channels.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 78,
    integration: 'slack',
    agent_id: null,
  },
  {
    key: 'slack:thread-context',
    content:
      'When an agent references "the thread" or "what we discussed", check the relevant Slack channel for context before responding. Thread conversations often contain decisions and preferences not captured elsewhere.',
    category: 'context',
    memory_type: 'context',
    importance_score: 75,
    integration: 'slack',
    agent_id: null,
  },
  {
    key: 'slack:notification-preferences',
    content:
      'Configure notification preferences to match your workflow: task completions, build failures, and review requests are high-value notifications. Routine status updates can be batched or muted.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 72,
    integration: 'slack',
    agent_id: null,
  },
  {
    key: 'slack:agent-messaging',
    content:
      'Agents can send messages to Slack channels for status updates, review results, and alerts. Configure which events trigger messages in workspace settings. Keep agent messages concise and actionable.',
    category: 'context',
    memory_type: 'context',
    importance_score: 70,
    integration: 'slack',
    agent_id: null,
  },
];

// ── Voice/TTS Integration Pack ───────────────────────────────────────────────

export const VOICE_PACK: SeedMemory[] = [
  {
    key: 'voice:pronunciation-dictionary',
    content:
      'Manage a pronunciation dictionary for technical terms, product names, and acronyms. Add entries when TTS mispronounces words. The dictionary applies across all agents with voice enabled.',
    category: 'context',
    memory_type: 'context',
    importance_score: 72,
    integration: 'voice',
    agent_id: null,
  },
  {
    key: 'voice:cloning-workflow',
    content:
      'Voice cloning creates a custom voice from audio samples. Upload clear, consistent samples (3-5 minutes of speech). Test the cloned voice before deploying. Each agent can have a unique voice or share one.',
    category: 'context',
    memory_type: 'context',
    importance_score: 70,
    integration: 'voice',
    agent_id: null,
  },
  {
    key: 'voice:streaming-vs-batch',
    content:
      'TTS streaming delivers audio in real-time chunks — use for interactive conversations. Batch rendering generates complete audio files — use for content creation and export. Streaming has lower latency; batch has higher quality consistency.',
    category: 'fact',
    memory_type: 'fact',
    importance_score: 68,
    integration: 'voice',
    agent_id: null,
  },
];

// ── BYOK (Bring Your Own Key) Pack ───────────────────────────────────────────

export const BYOK_PACK: SeedMemory[] = [
  {
    key: 'byok:key-management',
    content:
      'API keys are encrypted at rest (AES-256-GCM). Only the last 4 characters are visible for identification. Rotate keys regularly. Keys can be scoped per-workspace or shared across the organization.',
    category: 'fact',
    memory_type: 'fact',
    importance_score: 78,
    integration: 'byok',
    agent_id: null,
  },
  {
    key: 'byok:cost-awareness',
    content:
      'Your own API keys bypass platform usage limits for LLM and TTS. Monitor spending through your provider dashboard. Set budget alerts in your provider account to avoid surprises. Platform analytics track token usage but not dollar cost for BYOK.',
    category: 'context',
    memory_type: 'context',
    importance_score: 80,
    integration: 'byok',
    agent_id: null,
  },
  {
    key: 'byok:provider-fallback',
    content:
      'When a BYOK key is configured, it takes precedence over platform-provided keys. If your key fails validation, the system falls back to platform keys (subject to plan limits). Check key status in Settings → Integrations.',
    category: 'fact',
    memory_type: 'fact',
    importance_score: 75,
    integration: 'byok',
    agent_id: null,
  },
];

// ── Per-Agent Starter Memories ───────────────────────────────────────────────

export const AGENT_MEMORIES: SeedMemory[] = [
  // Lead Agent
  {
    key: 'agent:lead:coding-philosophy',
    content:
      'The lead agent codes directly. Delegation is for parallelism, not hierarchy. When you have context on a task, implement it yourself rather than handing it off. Only delegate when multiple tasks can be worked in parallel.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 90,
    integration: null,
    agent_id: 'lead',
  },
  {
    key: 'agent:lead:task-ownership',
    content:
      'Own the full lifecycle: claim a task when starting, implement the solution, verify it works (type-check, tests, build), and complete it with a clear outcome summary. The board reflects real-time state at all times.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 88,
    integration: null,
    agent_id: 'lead',
  },
  {
    key: 'agent:lead:architecture-decisions',
    content:
      'Architecture decisions should favor simplicity. Avoid over-engineering — build what is needed now, not what might be needed later. Prefer editing existing files over creating new ones. Keep abstractions minimal until patterns emerge from repetition.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 85,
    integration: null,
    agent_id: 'lead',
  },
  {
    key: 'agent:lead:security-awareness',
    content:
      'Never expose service keys client-side. Validate all inputs at API boundaries. Every new database table needs Row Level Security policies. Never leak internal errors to the client — log server-side, return safe messages.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 92,
    integration: null,
    agent_id: 'lead',
  },

  // Reviewer Agent
  {
    key: 'agent:reviewer:review-format',
    content:
      'Produce structured code reviews with automated results (type-check, tests, lint, build) and manual findings. Categorize findings by severity (critical, high, medium, low). Each finding gets a specific file path and line number when possible.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 88,
    integration: null,
    agent_id: 'reviewer',
  },
  {
    key: 'agent:reviewer:auto-fix-findings',
    content:
      'For each issue found during code review, create a fix task with a clear description. Execute the fix immediately. All critical and high findings must be resolved before the review passes. Medium and low findings can be deferred with justification.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 85,
    integration: null,
    agent_id: 'reviewer',
  },
  {
    key: 'agent:reviewer:security-checklist',
    content:
      'Security review checklist: Check for command injection, XSS, SQL injection, and OWASP top 10. Verify API routes authenticate and authorize. Check that secrets are not hardcoded. Verify CORS and CSRF protections. Check for timing attacks on authentication.',
    category: 'context',
    memory_type: 'context',
    importance_score: 90,
    integration: null,
    agent_id: 'reviewer',
  },

  // PM Agent
  {
    key: 'agent:pm:prd-structure',
    content:
      'PRDs follow a structured format: Problem Statement, Solution (with numbered patterns/features), Dependencies, Success Criteria, Out of Scope, and Risks. Keep PRDs concise — focus on the "what" and "why", leave the "how" to implementation tasks.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 85,
    integration: null,
    agent_id: 'pm',
  },
  {
    key: 'agent:pm:scope-management',
    content:
      'Guard scope aggressively. If a task grows beyond its original description, split it into separate tasks. New ideas go into the backlog, not into the current sprint. Every scope expansion requires explicit approval.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 82,
    integration: null,
    agent_id: 'pm',
  },
  {
    key: 'agent:pm:retro-facilitation',
    content:
      'Retrospectives produce three sections: Pros (what went well), Cons (what needs improvement), and Action Items (concrete next steps). Each action item becomes a real task. The retro captures learnings for future projects.',
    category: 'context',
    memory_type: 'context',
    importance_score: 80,
    integration: null,
    agent_id: 'pm',
  },

  // Designer Agent
  {
    key: 'agent:designer:design-tokens',
    content:
      'Always use design tokens from the theme — never hardcode colors, spacing, or typography. Dark mode is the default. Test all UI changes in both light and dark themes. Use responsive patterns that work on all screen sizes.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 85,
    integration: null,
    agent_id: 'designer',
  },
  {
    key: 'agent:designer:accessibility',
    content:
      'Every interactive element needs keyboard navigation and ARIA labels. Check color contrast ratios. Ensure focus indicators are visible. Loading, error, and empty states must all have appropriate UI — never show a blank screen.',
    category: 'decision',
    memory_type: 'decision',
    importance_score: 88,
    integration: null,
    agent_id: 'designer',
  },
  {
    key: 'agent:designer:design-feedback',
    content:
      'Design feedback reviews cover: visual design (tokens, spacing, typography), UX (flow, states, keyboard nav, ARIA), and PRD compliance (every UI requirement has an implementation). Present findings with specific file paths and suggested fixes.',
    category: 'context',
    memory_type: 'context',
    importance_score: 80,
    integration: null,
    agent_id: 'designer',
  },

  // Researcher Agent
  {
    key: 'agent:researcher:source-quality',
    content:
      'Source quality hierarchy: primary sources (official docs, papers) > reputable secondary sources (established publications) > community sources (forums, blogs). Always cite sources. Distinguish between facts and opinions.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 82,
    integration: null,
    agent_id: 'researcher',
  },
  {
    key: 'agent:researcher:deliverable-format',
    content:
      'Research deliverables follow a structured format: Executive Summary, Key Findings (numbered), Methodology, Detailed Analysis, Recommendations, and Sources. Keep the executive summary under 3 paragraphs. Lead with actionable insights.',
    category: 'preference',
    memory_type: 'preference',
    importance_score: 80,
    integration: null,
    agent_id: 'researcher',
  },
];

// ── Pack Registry ────────────────────────────────────────────────────────────

/** All integration packs with their memory counts */
export const INTEGRATION_PACKS: Record<IntegrationGroup, SeedMemory[]> = {
  github: GITHUB_PACK,
  slack: SLACK_PACK,
  voice: VOICE_PACK,
  byok: BYOK_PACK,
};

/** Get memory count for an integration (for badge display) */
export function getIntegrationMemoryCount(integration: IntegrationGroup): number {
  return INTEGRATION_PACKS[integration]?.length ?? 0;
}

/** Get all memory counts for badge display */
export function getAllMemoryCounts(): Record<IntegrationGroup | 'core' | 'agents', number> {
  return {
    core: CORE_KNOWLEDGE.length,
    github: GITHUB_PACK.length,
    slack: SLACK_PACK.length,
    voice: VOICE_PACK.length,
    byok: BYOK_PACK.length,
    agents: AGENT_MEMORIES.length,
  };
}

// ── Seeding Functions ────────────────────────────────────────────────────────

/**
 * Seed core knowledge memories into a workspace.
 * Called during onboarding — these are always seeded regardless of integrations.
 */
export async function seedCoreKnowledge(params: {
  userId: string;
  orgId: string;
  workspaceId: string;
}): Promise<number> {
  return seedMemoryPack(params, CORE_KNOWLEDGE);
}

/**
 * Seed integration-specific memories when an integration is connected.
 * Called when: GitHub connected, Slack connected, voice configured, BYOK key added.
 */
export async function seedIntegrationMemories(
  params: { userId: string; orgId: string; workspaceId: string },
  integration: IntegrationGroup,
): Promise<number> {
  const pack = INTEGRATION_PACKS[integration];
  if (!pack) return 0;
  return seedMemoryPack(params, pack);
}

/**
 * Soft-remove integration memories when an integration is disconnected.
 * Sets expires_at to now — memories become inactive but are not deleted.
 * If the integration is reconnected, clearExpiredIntegrationMemories reactivates them.
 */
export async function deactivateIntegrationMemories(
  workspaceId: string,
  integration: IntegrationGroup,
): Promise<number> {
  const service = createServiceClient();
  const pack = INTEGRATION_PACKS[integration];
  if (!pack) return 0;

  const keys = pack.map((m) => m.key);
  const { data } = await service
    .from('agent_memory')
    .update({ expires_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('source', 'system')
    .in('key', keys)
    .select('id');

  return data?.length ?? 0;
}

/**
 * Reactivate integration memories when an integration is reconnected.
 * Clears expires_at on previously deactivated memories.
 */
export async function reactivateIntegrationMemories(
  workspaceId: string,
  integration: IntegrationGroup,
): Promise<number> {
  const service = createServiceClient();
  const pack = INTEGRATION_PACKS[integration];
  if (!pack) return 0;

  const keys = pack.map((m) => m.key);
  const { data } = await service
    .from('agent_memory')
    .update({ expires_at: null })
    .eq('workspace_id', workspaceId)
    .eq('source', 'system')
    .in('key', keys)
    .not('expires_at', 'is', null)
    .select('id');

  return data?.length ?? 0;
}

/**
 * Seed agent-specific starter memories when an agent is created.
 * Filters AGENT_MEMORIES by the agent's archetype ID.
 */
export async function seedAgentMemories(params: {
  userId: string;
  orgId: string;
  workspaceId: string;
  agentArchetype: string;
}): Promise<number> {
  const agentMemories = AGENT_MEMORIES.filter((m) => m.agent_id === params.agentArchetype);
  if (agentMemories.length === 0) return 0;
  return seedMemoryPack(
    { userId: params.userId, orgId: params.orgId, workspaceId: params.workspaceId },
    agentMemories,
  );
}

/**
 * Seed team-specific memories based on the matched template and agent roles.
 * Called during onboarding after agents are seeded — provides template-level
 * best practices and role-specific knowledge for each agent on the team.
 *
 * Memory layering: Universal (core) → Category (starter) → Template → Role
 */
export async function seedTeamMemories(params: {
  userId: string;
  orgId: string;
  workspaceId: string;
  templateId: string;
  agentRoles: string[]; // e.g. ['lead', 'reviewer', 'pm', 'designer']
}): Promise<{ templateCount: number; roleCount: number }> {
  const { templateId, agentRoles, ...baseParams } = params;

  // 1. Seed template-specific memories (shared across all agents on this team)
  const templateMems = getTemplateMemories(templateId);
  const templateSeeded =
    templateMems.length > 0
      ? await seedMemoryPackWithTags(baseParams, templateMems, `template:${templateId} team system`)
      : 0;

  // 2. Seed role-specific memories for each agent role on the team
  let roleSeeded = 0;
  const seenKeys = new Set<string>();

  for (const role of agentRoles) {
    const roleMems = getRoleMemories(role).filter((m) => !seenKeys.has(m.key));
    for (const m of roleMems) seenKeys.add(m.key);
    if (roleMems.length > 0) {
      roleSeeded += await seedMemoryPackWithTags(baseParams, roleMems, `role:${role} team system`);
    }
  }

  return { templateCount: templateSeeded, roleCount: roleSeeded };
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function seedMemoryPack(
  params: { userId: string; orgId: string; workspaceId: string },
  memories: SeedMemory[],
): Promise<number> {
  const service = createServiceClient();

  // Idempotent: skip keys that already exist
  const { data: existing } = await service
    .from('agent_memory')
    .select('key')
    .eq('workspace_id', params.workspaceId)
    .eq('source', 'system')
    .in(
      'key',
      memories.map((m) => m.key),
    );

  const existingKeys = new Set((existing ?? []).map((m) => m.key));
  const toInsert = memories.filter((m) => !existingKeys.has(m.key));

  if (toInsert.length === 0) return 0;

  const rows = toInsert.map((m) => ({
    key: m.key,
    content: m.content,
    category: m.category,
    source: 'system' as const,
    memory_type: m.memory_type,
    importance_score: m.importance_score > 1 ? m.importance_score / 100 : m.importance_score,
    user_id: params.userId,
    org_id: params.orgId,
    workspace_id: params.workspaceId,
    agent_id: m.agent_id ?? 'system',
    tags: m.integration ? `integration:${m.integration} system` : 'core system',
    expires_at: null,
    is_core: true,
  }));

  const { error } = await service.from('agent_memory').insert(rows);
  if (error) {
    console.error('[seed-knowledge] Failed to seed memories:', error.message);
    return 0;
  }

  return toInsert.length;
}

/**
 * Seed StarterMemory[] (from team-memories) with explicit tags.
 * Similar to seedMemoryPack but accepts the simpler StarterMemory interface
 * and allows callers to specify tags for filtering.
 */
async function seedMemoryPackWithTags(
  params: { userId: string; orgId: string; workspaceId: string },
  memories: import('@repo/db/starter-memories').StarterMemory[],
  tags: string,
): Promise<number> {
  const service = createServiceClient();

  const { data: existing } = await service
    .from('agent_memory')
    .select('key')
    .eq('workspace_id', params.workspaceId)
    .eq('source', 'system')
    .in(
      'key',
      memories.map((m) => m.key),
    );

  const existingKeys = new Set((existing ?? []).map((m) => m.key));
  const toInsert = memories.filter((m) => !existingKeys.has(m.key));

  if (toInsert.length === 0) return 0;

  const rows = toInsert.map((m) => ({
    key: m.key,
    content: m.content,
    category: m.category,
    source: 'system' as const,
    memory_type: m.memory_type,
    importance_score: m.importance_score > 1 ? m.importance_score / 100 : m.importance_score,
    user_id: params.userId,
    org_id: params.orgId,
    workspace_id: params.workspaceId,
    agent_id: 'system',
    tags,
    expires_at: null,
    is_core: true,
  }));

  const { error } = await service.from('agent_memory').insert(rows);
  if (error) {
    console.error('[seed-knowledge] Failed to seed team memories:', error.message);
    return 0;
  }

  return toInsert.length;
}

// ── Workspace CLAUDE.md Generator ────────────────────────────────────────────

/**
 * Generate a personalized CLAUDE.md for a workspace based on onboarding answers.
 * Stored in brain_manifest as the workspace's root context file.
 */
export function generateWorkspaceClaudeMd(params: {
  workspaceName: string;
  role: string;
  goal: string;
  autonomy: string;
  domain: string;
}): string {
  const { workspaceName, role, goal, autonomy, domain } = params;

  const autonomySection =
    autonomy === 'full'
      ? 'Full autonomy — proceed without asking unless the change is destructive or irreversible.'
      : autonomy === 'guided'
        ? 'Guided mode — explain your plan before executing. Wait for confirmation on non-trivial changes.'
        : 'Collaborative mode — discuss approach, get alignment, then execute.';

  const contextLines = [
    role && `- **Role:** ${role}`,
    goal && `- **Primary goal:** ${goal}`,
    domain && `- **Domain:** ${domain}`,
  ].filter(Boolean);

  return `# ${workspaceName}

## Context
${contextLines.length > 0 ? contextLines.join('\n') : '- General workspace'}

## Working Style
- ${autonomySection}
- Always create a task before starting work — tasks are the universal unit of work.
- Claim tasks at start, complete with outcome when done. The board must reflect real-time state.

## Task Conventions
- Titles: 70 character max, imperative phrasing
- Descriptions: structured format with ## What / ## Approach sections minimum
- All tasks start as \`inbox\` — move through the lifecycle as work progresses

## Commit Protocol
- Run \`git diff --staged\` before every commit to verify the changeset
- Never bypass pre-commit hooks unless explicitly told to
- Create NEW commits rather than amending (unless explicitly asked)

## Quality Gates
- Run type-check and tests before marking work complete
- Never leak internal errors to the client — log server-side, return safe messages
- Validate inputs at API boundaries

## Memory
- Save important decisions, preferences, and context to memory for cross-session persistence
- Use structured memory types: preference, decision, context, fact
- Check memory when the user references prior work or decisions
`;
}
