/**
 * Activity-to-Memory Mapper
 *
 * Maps activity_log events into memory candidates. Only high-signal events
 * pass through; low-value noise (page views, routine reads) is filtered out.
 */

import type { MemoryCategory, MemoryType } from '@repo/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: string;
  event_type: string;
  severity: string;
  source: string | null;
  title: string;
  details: Record<string, unknown> | null;
  task_id: string | null;
  agent_id: string | null;
  actor_user_id: string | null;
  workspace_id: string | null;
  created_at: string;
}

export interface MemoryCandidate {
  key: string;
  content: string;
  category: MemoryCategory;
  memory_type: MemoryType;
  tags: string;
  source: string;
  importance_score: number;
  workspace_id: string;
  user_id: string | null;
  agent_id: string;
  /** Original activity IDs that contributed to this memory */
  activity_ids: string[];
}

// ---------------------------------------------------------------------------
// High-signal event types and their mapping rules
// ---------------------------------------------------------------------------

interface MappingRule {
  /** Minimum severity required (info < warning < error) */
  minSeverity?: string;
  /** Memory category to assign */
  category: MemoryCategory;
  memoryType: MemoryType;
  /** Base importance score (0-1) */
  importance: number;
  /** Build the memory key from the event */
  keyFn: (e: ActivityEvent) => string | null;
  /** Build the memory content from the event */
  contentFn: (e: ActivityEvent) => string | null;
  /** Tags to attach */
  tagsFn?: (e: ActivityEvent) => string;
}

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, error: 2 };

function meetsSeverity(actual: string, minimum?: string): boolean {
  if (!minimum) return true;
  return (SEVERITY_ORDER[actual] ?? 0) >= (SEVERITY_ORDER[minimum] ?? 0);
}

/** Extract a summary from details, capped at a reasonable length. */
function detailSummary(details: Record<string, unknown> | null, maxLen = 800): string {
  if (!details) return '';
  // Prefer explicit summary/description fields
  const summary = (details.summary ?? details.description ?? details.outcome ?? '') as string;
  if (summary) return summary.slice(0, maxLen);
  // Fallback: stringify top-level keys (skip large nested objects)
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}: ${String(v)}`);
    }
  }
  return parts.join('; ').slice(0, maxLen);
}

const MAPPING_RULES: Record<string, MappingRule> = {
  // ---- Task lifecycle ----
  task_completed: {
    category: 'context',
    memoryType: 'context',
    importance: 0.7,
    keyFn: (e) => (e.task_id ? `task_completed_${e.task_id}` : null),
    contentFn: (e) => {
      const ds = detailSummary(e.details);
      return `Task completed: ${e.title}${ds ? `. ${ds}` : ''}`;
    },
    tagsFn: (e) =>
      ['task', 'completed', e.details?.project_id ? 'project' : ''].filter(Boolean).join(','),
  },

  task_blocked: {
    category: 'context',
    memoryType: 'context',
    importance: 0.6,
    keyFn: (e) => (e.task_id ? `task_blocked_${e.task_id}` : null),
    contentFn: (e) => {
      const reason = (e.details?.reason ?? e.details?.blocker ?? '') as string;
      return `Task blocked: ${e.title}${reason ? `. Reason: ${reason}` : ''}`;
    },
    tagsFn: () => 'task,blocked',
  },

  // ---- Project milestones ----
  project_completed: {
    category: 'decision',
    memoryType: 'decision',
    importance: 0.85,
    keyFn: (e) => {
      const pid = (e.details?.project_id ?? e.task_id) as string | null;
      return pid ? `project_completed_${pid}` : null;
    },
    contentFn: (e) => {
      const ds = detailSummary(e.details);
      return `Project completed: ${e.title}${ds ? `. ${ds}` : ''}`;
    },
    tagsFn: () => 'project,milestone,completed',
  },

  sprint_completed: {
    category: 'context',
    memoryType: 'context',
    importance: 0.7,
    keyFn: (e) => {
      const sid = (e.details?.sprint_id ?? e.task_id) as string | null;
      return sid ? `sprint_completed_${sid}` : null;
    },
    contentFn: (e) => `Sprint completed: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'sprint,milestone',
  },

  // ---- Agent interactions ----
  agent_output: {
    category: 'context',
    memoryType: 'context',
    importance: 0.6,
    keyFn: (e) => {
      const agentId = e.agent_id ?? (e.details?.agent_id as string);
      return agentId ? `agent_output_${agentId}_${e.id.slice(0, 8)}` : null;
    },
    contentFn: (e) => {
      const ds = detailSummary(e.details);
      return `Agent output (${e.agent_id ?? 'unknown'}): ${e.title}${ds ? `. ${ds}` : ''}`;
    },
    tagsFn: (e) => `agent,${e.agent_id ?? 'unknown'}`,
  },

  code_review: {
    category: 'pattern',
    memoryType: 'pattern',
    importance: 0.75,
    keyFn: (e) => `code_review_${e.id.slice(0, 8)}`,
    contentFn: (e) => `Code review finding: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'code-review,pattern',
  },

  design_feedback: {
    category: 'pattern',
    memoryType: 'pattern',
    importance: 0.65,
    keyFn: (e) => `design_feedback_${e.id.slice(0, 8)}`,
    contentFn: (e) => `Design feedback: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'design,feedback,pattern',
  },

  // ---- Settings / integrations ----
  settings_changed: {
    category: 'decision',
    memoryType: 'decision',
    importance: 0.65,
    keyFn: (e) => {
      const setting = (e.details?.setting ?? e.details?.key ?? 'unknown') as string;
      return `settings_changed_${setting}`;
    },
    contentFn: (e) => {
      const setting = (e.details?.setting ?? e.details?.key ?? '') as string;
      const from = e.details?.from as string | undefined;
      const to = e.details?.to as string | undefined;
      let msg = `Settings changed: ${e.title}`;
      if (setting) msg += ` (${setting})`;
      if (from && to) msg += `. Changed from "${from}" to "${to}"`;
      return msg;
    },
    tagsFn: () => 'settings,decision',
  },

  integration_connected: {
    category: 'fact',
    memoryType: 'fact',
    importance: 0.7,
    keyFn: (e) => {
      const name = (e.details?.integration ?? e.details?.name ?? 'unknown') as string;
      return `integration_connected_${name}`;
    },
    contentFn: (e) => `Integration connected: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'integration,connected',
  },

  integration_disconnected: {
    category: 'fact',
    memoryType: 'fact',
    importance: 0.6,
    keyFn: (e) => {
      const name = (e.details?.integration ?? e.details?.name ?? 'unknown') as string;
      return `integration_disconnected_${name}`;
    },
    contentFn: (e) => `Integration disconnected: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'integration,disconnected',
  },

  // ---- Errors worth remembering ----
  error: {
    minSeverity: 'error',
    category: 'context',
    memoryType: 'context',
    importance: 0.8,
    keyFn: (e) => `error_${e.id.slice(0, 8)}`,
    contentFn: (e) => `Error encountered: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'error,incident',
  },

  // ---- Plan changes ----
  plan_upgraded: {
    category: 'fact',
    memoryType: 'fact',
    importance: 0.8,
    keyFn: (e) => {
      const plan = (e.details?.plan ?? 'unknown') as string;
      return `plan_upgraded_${plan}`;
    },
    contentFn: (e) => `Plan upgraded: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'billing,plan,upgrade',
  },

  // ---- Skill / brain changes ----
  skill_installed: {
    category: 'fact',
    memoryType: 'fact',
    importance: 0.6,
    keyFn: (e) => {
      const skill = (e.details?.skill_id ?? e.details?.name ?? 'unknown') as string;
      return `skill_installed_${skill}`;
    },
    contentFn: (e) => `Skill installed: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'skill,installed',
  },

  agent_created: {
    category: 'fact',
    memoryType: 'fact',
    importance: 0.65,
    keyFn: (e) => `agent_created_${e.agent_id ?? e.id.slice(0, 8)}`,
    contentFn: (e) => `Agent created: ${e.title}. ${detailSummary(e.details)}`,
    tagsFn: () => 'agent,created',
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a batch of activity events to memory candidates.
 * Returns only high-signal events that pass filtering and dedup.
 */
export function mapActivitiesToMemories(events: ActivityEvent[]): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const event of events) {
    if (!event.workspace_id) continue;

    const rule = MAPPING_RULES[event.event_type];
    if (!rule) continue;

    // Check severity threshold
    if (!meetsSeverity(event.severity, rule.minSeverity)) continue;

    // Generate key and content
    const key = rule.keyFn(event);
    if (!key) continue;

    const content = rule.contentFn(event);
    if (!content || content.length < 10) continue;

    // Deduplicate within batch
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    candidates.push({
      key,
      content: content.slice(0, 5000), // cap content length
      category: rule.category,
      memory_type: rule.memoryType,
      tags: rule.tagsFn?.(event) ?? '',
      source: 'activity-ingestion',
      importance_score: rule.importance,
      workspace_id: event.workspace_id,
      user_id: event.actor_user_id,
      agent_id: event.agent_id ?? 'system',
      activity_ids: [event.id],
    });
  }

  return candidates;
}

/**
 * Score and filter candidates. Only returns candidates above the threshold.
 */
export function filterByRelevance(
  candidates: MemoryCandidate[],
  threshold = 0.5,
): MemoryCandidate[] {
  return candidates.filter((c) => c.importance_score >= threshold);
}
