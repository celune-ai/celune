/**
 * apps/platform/src/lib/ward/config.ts
 *
 * WARD agent configuration, severity mapping, and auto-fix eligibility rules.
 * WARD monitors Sentry errors and orchestrates automated fixes.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface WardConfig {
  enabled: boolean;
  autoFixEnabled: boolean;
  maxFixesPerHour: number;
  maxFixesPerDay: number;
  allowedSeverities: SentrySeverity[];
  excludedProjects: string[];
  excludedFiles: string[]; // glob patterns to never auto-fix
  requireApproval: boolean; // if true, always send to Slack for approval
  slackNotifyChannel: string | null;
}

export type SentrySeverity = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

export type WardPriority = 'low' | 'medium' | 'high' | 'critical';

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_WARD_CONFIG: WardConfig = {
  enabled: true,
  autoFixEnabled: true,
  maxFixesPerHour: 5,
  maxFixesPerDay: 20,
  allowedSeverities: ['error', 'fatal'],
  excludedProjects: [],
  excludedFiles: ['*.test.*', '*.spec.*', 'node_modules/**'],
  requireApproval: true, // safe default — require human approval
  slackNotifyChannel: null,
};

// ── Severity mapping ────────────────────────────────────────────────────────

const SEVERITY_TO_PRIORITY: Record<SentrySeverity, WardPriority> = {
  debug: 'low',
  info: 'low',
  warning: 'medium',
  error: 'high',
  fatal: 'critical',
};

/**
 * Map a Sentry severity level to a WARD priority.
 * Unknown levels default to 'medium'.
 */
export function mapSeverityToPriority(level: string): WardPriority {
  return SEVERITY_TO_PRIORITY[level as SentrySeverity] ?? 'medium';
}

// ── Auto-fix eligibility ────────────────────────────────────────────────────

/**
 * Checks whether a given error is eligible for auto-fix based on config rules.
 * Returns `{ eligible: true }` or `{ eligible: false, reason: string }`.
 */
export function checkAutoFixEligibility(
  config: WardConfig,
  error: { level: string; projectSlug?: string; culprit?: string },
): { eligible: boolean; reason?: string } {
  if (!config.enabled) {
    return { eligible: false, reason: 'WARD is disabled' };
  }

  if (!config.autoFixEnabled) {
    return { eligible: false, reason: 'Auto-fix is disabled' };
  }

  if (!config.allowedSeverities.includes(error.level as SentrySeverity)) {
    return { eligible: false, reason: `Severity '${error.level}' not in allowed list` };
  }

  if (error.projectSlug && config.excludedProjects.includes(error.projectSlug)) {
    return { eligible: false, reason: `Project '${error.projectSlug}' is excluded` };
  }

  if (error.culprit && isFileExcluded(error.culprit, config.excludedFiles)) {
    return { eligible: false, reason: `File '${error.culprit}' matches exclusion pattern` };
  }

  return { eligible: true };
}

/**
 * Simple glob-like matching for excluded file patterns.
 * Supports `*` (any segment chars) and `**` (any path).
 */
function isFileExcluded(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(filePath)) {
      return true;
    }
  }
  return false;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars (except * and ?)
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*');
  return new RegExp(`^${escaped}$`);
}
