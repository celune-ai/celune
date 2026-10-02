/**
 * Standard format templates for agent PR review comments.
 *
 * Defines consistent formatting for findings, fix replies,
 * deferred items, summaries, and status indicators.
 */

export const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\u{1F534}',
  high: '\u{1F7E0}',
  medium: '\u{1F7E1}',
  low: '\u{1F535}',
};

export function formatFinding(finding: {
  severity: string;
  message: string;
  suggestion?: string;
}): string {
  const emoji = SEVERITY_EMOJI[finding.severity] || '\u26AA';
  let text = `${emoji} **${finding.severity.toUpperCase()}**: ${finding.message}`;
  if (finding.suggestion) {
    text += `\n\n**Suggested fix:** ${finding.suggestion}`;
  }
  return text;
}

export function formatFixReply(commitHash: string, description?: string): string {
  const short = commitHash.slice(0, 7);
  let text = `Fixed in \`${short}\``;
  if (description) text += ` \u2014 ${description}`;
  return text;
}

export function formatDeferredReply(taskId: string, reason?: string): string {
  const short = taskId.slice(0, 8);
  let text = `\u{1F4CB} Deferred to inbox (task \`${short}\`)`;
  if (reason) text += ` \u2014 ${reason}`;
  return text;
}

export function formatReviewSummary(
  findings: Array<{ severity: string; fixed: boolean }>,
  _agent: string,
): string {
  const total = findings.length;
  const fixed = findings.filter((f) => f.fixed).length;
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;

  const parts: string[] = [];
  parts.push(`**${total} findings** (${fixed} fixed, ${total - fixed} remaining)`);
  if (critical > 0) parts.push(`${critical} critical`);
  if (high > 0) parts.push(`${high} high`);

  return parts.join(' \u00B7 ');
}

/** Status indicators for live dashboard comments. */
export function formatTaskStatus(status: string, commitHash?: string): string {
  switch (status) {
    case 'done':
      return commitHash ? `\u2705 Fixed in \`${commitHash.slice(0, 7)}\`` : '\u2705 Done';
    case 'in_progress':
      return '\u23F3 In progress';
    case 'inbox':
      return '\u{1F4CB} Deferred to inbox';
    case 'blocked':
      return '\u{1F6AB} Blocked';
    default:
      return `\u{1F4CB} ${status}`;
  }
}
