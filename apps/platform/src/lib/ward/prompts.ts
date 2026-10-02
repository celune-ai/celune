/**
 * apps/platform/src/lib/ward/prompts.ts
 *
 * Fix prompt templates for the WARD auto-fix agent.
 * Builds structured prompts that include error context, stack trace,
 * and relevant file information for the AI to generate a fix.
 */

export interface ErrorContext {
  title: string;
  culprit: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Build a fix prompt for the AI model.
 *
 * The prompt instructs the model to analyze the error, identify the root cause,
 * and produce a minimal, safe fix with an explanation.
 */
export function buildFixPrompt(error: ErrorContext): string {
  const sections: string[] = [];

  sections.push(`You are WARD, an automated error-fixing agent. Analyze the following production error and produce a minimal, safe fix.

## Error
**Title:** ${error.title}
**Culprit:** ${error.culprit}`);

  if (error.stackTrace) {
    sections.push(`## Stack Trace
\`\`\`
${error.stackTrace}
\`\`\``);
  }

  if (error.metadata && Object.keys(error.metadata).length > 0) {
    const metaLines = Object.entries(error.metadata)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `- **${k}:** ${String(v)}`);

    if (metaLines.length > 0) {
      sections.push(`## Metadata
${metaLines.join('\n')}`);
    }
  }

  sections.push(`## Instructions
1. Identify the root cause from the error title, culprit, and stack trace.
2. Determine the minimal code change to fix the issue.
3. Do NOT change unrelated code. Keep the fix as small as possible.
4. If the error cannot be safely auto-fixed (e.g., data corruption, auth issue, infrastructure), respond with CANNOT_AUTO_FIX and explain why.

## Response Format
Respond with a JSON object:
\`\`\`json
{
  "canFix": true | false,
  "reason": "Brief explanation of the root cause",
  "fix": {
    "file": "path/to/file.ts",
    "description": "What the fix does",
    "diff": "unified diff of the change"
  }
}
\`\`\``);

  return sections.join('\n\n');
}

/**
 * Build a review summary for Slack notification.
 * Used when requireApproval is true — human reviews before applying.
 */
export function buildReviewSummary(
  error: ErrorContext,
  fix: { description: string; diff?: string },
): string {
  const lines: string[] = [
    `*WARD Auto-Fix Review*`,
    ``,
    `*Error:* ${error.title}`,
    `*Culprit:* \`${error.culprit}\``,
    `*Fix:* ${fix.description}`,
  ];

  if (fix.diff) {
    lines.push(``, `*Diff:*`, '```', fix.diff, '```');
  }

  return lines.join('\n');
}
