/**
 * Markdown templates for PR review comments posted by celune[bot].
 *
 * Each agent (SCAN, NOIR, SAGE, RICK) has a distinct comment format
 * used during the /build closing gates.
 */

export function scanReviewBody(
  findings: Array<{ severity: string; title: string; status: string }>,
): string {
  const rows = findings
    .map((f, i) => `| ${i + 1} | ${f.severity} | ${f.title} | ${f.status} |`)
    .join('\n');

  const hasCritical = findings.some((f) => f.severity === 'critical' || f.severity === 'high');

  return `## Code Review — SCAN

| # | Severity | Finding | Status |
|---|----------|---------|--------|
${rows}

**Verdict:** ${hasCritical ? 'Requesting changes' : 'Approved'}`;
}

export function noirFeedbackBody(findings: string[], verdict: string): string {
  const list = findings.map((f) => `- ${f}`).join('\n');
  return `## Design Feedback — NOIR

${list}

**Verdict:** ${verdict}`;
}

export function sageRetroBody(opts: {
  wentWell: string[];
  toImprove: string[];
  actionItems: Array<{ item: string; status: string }>;
}): string {
  const well = opts.wentWell.map((w) => `- ${w}`).join('\n');
  const improve = opts.toImprove.map((i) => `- ${i}`).join('\n');
  const actions = opts.actionItems
    .map((a) => `- ${a.status === 'done' ? '[x]' : '[ ]'} ${a.item}`)
    .join('\n');

  return `## Retrospective — SAGE

### What went well
${well}

### What to improve
${improve}

### Action items
${actions}`;
}

export function rickFixBody(fixes: Array<{ finding: string; commit: string }>): string {
  const list = fixes.map((f) => `- ${f.finding} → \`${f.commit.slice(0, 7)}\``).join('\n');
  return `## Fixes Applied — RICK

${list}`;
}
