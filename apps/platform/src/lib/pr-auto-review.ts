/**
 * Automated PR review pipeline.
 *
 * ## How It Works
 *
 * When a GitHub webhook fires for a PR event (opened/synchronize), the
 * `/api/hooks/github` route calls `triggerAgentPrReview()` fire-and-forget.
 * The pipeline fetches the PR diff via the GitHub App installation, sends it
 * to Claude (Haiku model for cost efficiency), and posts findings as inline
 * review comments via celune[bot].
 *
 * ## Three Review Passes
 *
 * 1. **SCAN** — Code review: security vulnerabilities, correctness issues,
 *    type safety gaps, performance concerns, and best-practice violations.
 * 2. **NOIR** — Design feedback: UX/accessibility review, only triggered
 *    when UI files (.tsx, .css, .svg) are in the changeset.
 * 3. **SAGE** — PR summary: high-level changelog with key changes, risk
 *    assessment, and deployment considerations.
 *
 * Each pass uses agent-specific system prompts from `pr-review-templates.ts`
 * and posts its findings as a separate review or comment on the PR.
 *
 * ## Configuration
 *
 * Review behavior is controlled per-workspace via the `github_review_settings`
 * table in Supabase. Settings include:
 * - `auto_review_enabled` — master toggle (default: true when GitHub connected)
 * - `review_agents` — which agents run (default: all three)
 * - `min_lines_changed` — skip reviews for trivial PRs
 * - `ignore_paths` — glob patterns to exclude from review (e.g., `*.lock`)
 *
 * ## Cost Estimate
 *
 * Each full review (3 passes) on a ~500-line diff costs approximately
 * $0.01-0.03 using Claude Haiku. Large diffs (2000+ lines) are chunked
 * and may cost up to $0.10. The cost is tracked in the workspace analytics
 * dashboard under "Agent Costs".
 */

import Anthropic from '@anthropic-ai/sdk';
import { createInstallationOctokit } from './github-app';
import {
  createAgentReview,
  postPrComment,
  submitApproval,
  type ReviewFinding,
} from './github-pr-review';
import { createServiceClient } from '@repo/db/service';

interface AutoReviewOpts {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  headBranch: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Run the full agent PR review pipeline.
 * Called fire-and-forget from the webhook handler.
 */
export async function triggerAgentPrReview(opts: AutoReviewOpts): Promise<void> {
  const { installationId, owner, repo, prNumber } = opts;

  const octokit = await createInstallationOctokit(installationId);

  // Fetch the PR diff
  const { data: diffData } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  });
  const diff = (diffData as unknown as string) ?? '';

  // Fetch changed files with patches
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  if (!files.length) return;

  // Truncate diff for Claude context (keep under 100K chars)
  const diffForReview = diff.slice(0, 100_000);

  const filesSummary = files
    .map((f) => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`)
    .join('\n');

  // ── SCAN: Code Review ────────────────────────────────────────────────

  const scanFindings = await runCodeReview(diffForReview, filesSummary, opts);

  if (scanFindings.length > 0) {
    // Post as inline review with line-level comments
    const approve = !scanFindings.some((f) => f.severity === 'critical' || f.severity === 'high');
    const reviewSummary = `Code review: ${scanFindings.length} finding(s) — ${scanFindings.filter((f) => f.severity === 'critical').length} critical, ${scanFindings.filter((f) => f.severity === 'high').length} high, ${scanFindings.filter((f) => f.severity === 'medium').length} medium, ${scanFindings.filter((f) => f.severity === 'low').length} low`;

    await createAgentReview({
      installationId,
      owner,
      repo,
      prNumber,
      agent: 'scan',
      findings: scanFindings,
      summary: reviewSummary,
      approve,
      workspaceId: opts.workspaceId,
    });
  } else {
    // No findings — post approval
    await createAgentReview({
      installationId,
      owner,
      repo,
      prNumber,
      agent: 'scan',
      findings: [],
      summary: 'Code review passed — no issues found.',
      approve: true,
      workspaceId: opts.workspaceId,
    });
  }

  // ── Run NOIR + SAGE + Tasks concurrently to stay within timeout ──────

  const uiFiles = files.filter((f) => /\.(tsx|css|scss)$/.test(f.filename));

  // Run NOIR and SAGE in parallel (both are Claude calls)
  const [designFeedback, sageSummary] = await Promise.all([
    // NOIR: Design review (skip if no UI files)
    uiFiles.length > 0
      ? runDesignReview(
          uiFiles
            .map((f) => f.patch ?? '')
            .filter(Boolean)
            .join('\n\n')
            .slice(0, 50_000),
          uiFiles.map((f) => f.filename),
          opts,
        )
      : Promise.resolve(''),
    // SAGE: PR summary
    runPrSummary(
      diffForReview,
      filesSummary,
      buildReviewDialog(scanFindings, '', uiFiles.length > 0),
      opts,
    ),
  ]);

  // Post NOIR comment if there was feedback
  if (designFeedback) {
    postPrComment({
      installationId,
      owner,
      repo,
      prNumber,
      agent: 'noir',
      body: designFeedback,
      workspaceId: opts.workspaceId,
    }).catch((err) => console.error('[pr-auto-review] NOIR comment failed:', err));
  }

  // Create tasks from findings (non-blocking — don't let it block SAGE)
  const taskCreationPromise = createTasksFromFindings({
    installationId,
    owner,
    repo,
    workspaceId: opts.workspaceId,
    prNumber,
    prTitle: opts.prTitle,
    scanFindings,
    designFeedback,
    hasUiChanges: uiFiles.length > 0,
  }).catch((err) => {
    console.error('[pr-auto-review] Task creation failed:', err);
    return [] as CreatedTask[];
  });

  // Wait for tasks so we can include them in SAGE summary
  const createdTasks = await taskCreationPromise;
  const taskTable = buildTaskStatusTable(createdTasks);
  const fullSummary = sageSummary + '\n\n' + taskTable;

  // Post SAGE summary with task table
  await postPrComment({
    installationId,
    owner,
    repo,
    prNumber,
    agent: 'sage',
    body: fullSummary,
    workspaceId: opts.workspaceId,
  });

  // ── Store structured review summary for retro ───────────────────────
  await storeReviewSummary({
    workspaceId: opts.workspaceId,
    prNumber,
    prTitle: opts.prTitle,
    repo: `${owner}/${repo}`,
    scanFindings,
    designFeedback,
    sageSummary,
    hasUiChanges: uiFiles.length > 0,
    filesChanged: files.length,
    additions: opts.additions,
    deletions: opts.deletions,
  });

  // ── Auto-approve if no critical/high findings ──────────────────────
  const hasCriticalOrHigh = scanFindings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );

  if (!hasCriticalOrHigh) {
    try {
      await submitApproval({
        installationId,
        owner,
        repo,
        prNumber,
        body: `All findings are medium/low severity. No blockers — approved.\n\n${taskTable}`,
        workspaceId: opts.workspaceId,
      });
    } catch (err) {
      console.error(`[pr-auto-review] Failed to submit approval for PR #${prNumber}:`, err);
    }
  }

  console.log(
    `[pr-auto-review] Completed review for PR #${prNumber} in ${owner}/${repo}: ${scanFindings.length} findings, approved: ${!hasCriticalOrHigh}`,
  );
}

// ── Review dialog builder ────────────────────────────────────────────────

function buildReviewDialog(
  scanFindings: ReviewFinding[],
  designFeedback: string,
  hasUiChanges: boolean,
): string {
  const parts: string[] = [];

  parts.push('## Agent Review Dialog\n');

  // SCAN findings
  parts.push('### SCAN (Code Review)');
  if (scanFindings.length === 0) {
    parts.push('No issues found — approved.\n');
  } else {
    for (const f of scanFindings) {
      parts.push(`- **[${f.severity}]** \`${f.path}:${f.line}\` — ${f.body}`);
    }
    parts.push('');
  }

  // NOIR feedback
  if (hasUiChanges && designFeedback) {
    parts.push('### NOIR (Design Feedback)');
    parts.push(designFeedback);
    parts.push('');
  }

  return parts.join('\n');
}

// ── Store review summary for retro ───────────────────────────────────────

interface ReviewSummaryOpts {
  workspaceId: string;
  prNumber: number;
  prTitle: string;
  repo: string;
  scanFindings: ReviewFinding[];
  designFeedback: string;
  sageSummary: string;
  hasUiChanges: boolean;
  filesChanged: number;
  additions: number;
  deletions: number;
}

async function storeReviewSummary(opts: ReviewSummaryOpts): Promise<void> {
  try {
    const supabase = createServiceClient();

    // Store as activity_log entry with structured metadata for retro consumption
    await supabase.from('activity_log').insert({
      event_type: 'pr.review_complete',
      severity: opts.scanFindings.some((f) => f.severity === 'critical')
        ? 'error'
        : opts.scanFindings.some((f) => f.severity === 'high')
          ? 'warning'
          : 'info',
      source: 'pr-auto-review',
      title: `PR #${opts.prNumber} review complete — ${opts.scanFindings.length} findings`,
      workspace_id: opts.workspaceId,
      details: {
        pr_number: opts.prNumber,
        pr_title: opts.prTitle,
        repo: opts.repo,
        files_changed: opts.filesChanged,
        additions: opts.additions,
        deletions: opts.deletions,
        has_ui_changes: opts.hasUiChanges,
        // Structured findings for retro
        scan_findings_count: opts.scanFindings.length,
        scan_by_severity: {
          critical: opts.scanFindings.filter((f) => f.severity === 'critical').length,
          high: opts.scanFindings.filter((f) => f.severity === 'high').length,
          medium: opts.scanFindings.filter((f) => f.severity === 'medium').length,
          low: opts.scanFindings.filter((f) => f.severity === 'low').length,
        },
        scan_findings: opts.scanFindings.map((f) => ({
          path: f.path,
          line: f.line,
          severity: f.severity,
          body: f.body,
        })),
        noir_reviewed: opts.hasUiChanges,
        noir_feedback_length: opts.designFeedback.length,
        sage_summary: opts.sageSummary.slice(0, 2000),
        // Agent dialog for retro analysis
        review_dialog: buildReviewDialog(
          opts.scanFindings,
          opts.designFeedback,
          opts.hasUiChanges,
        ).slice(0, 5000),
      },
    });

    // Also log inter-agent message: SCAN → SAGE (findings handoff)
    if (opts.scanFindings.length > 0) {
      await supabase.from('activity_log').insert({
        event_type: 'agent.message',
        severity: 'info',
        source: 'pr-auto-review',
        title: `SCAN shared ${opts.scanFindings.length} findings with SAGE for PR #${opts.prNumber}`,
        agent_id: 'scan',
        workspace_id: opts.workspaceId,
        details: {
          from_agent: 'scan',
          to_agent: 'sage',
          message: `Found ${opts.scanFindings.length} issues in PR #${opts.prNumber}. ${opts.scanFindings.filter((f) => f.severity === 'critical' || f.severity === 'high').length} are high/critical priority.`,
          pr_number: opts.prNumber,
          repo: opts.repo,
          thread_title: `PR #${opts.prNumber} Review — ${opts.repo}`,
        },
      });
    }

    // NOIR → SAGE handoff if design review happened
    if (opts.hasUiChanges && opts.designFeedback) {
      await supabase.from('activity_log').insert({
        event_type: 'agent.message',
        severity: 'info',
        source: 'pr-auto-review',
        title: `NOIR shared design feedback with SAGE for PR #${opts.prNumber}`,
        agent_id: 'noir',
        workspace_id: opts.workspaceId,
        details: {
          from_agent: 'noir',
          to_agent: 'sage',
          message: `Design review complete for PR #${opts.prNumber}. ${opts.hasUiChanges ? 'UI changes reviewed.' : 'No UI changes.'}`,
          pr_number: opts.prNumber,
          repo: opts.repo,
          thread_title: `PR #${opts.prNumber} Review — ${opts.repo}`,
        },
      });
    }
  } catch (err) {
    console.error('[pr-auto-review] Failed to store review summary:', err);
  }
}

// ── Claude-powered review functions ──────────────────────────────────────

async function getAnthropicClient(): Promise<Anthropic> {
  return new Anthropic(); // uses ANTHROPIC_API_KEY env var
}

async function runCodeReview(
  diff: string,
  filesSummary: string,
  opts: AutoReviewOpts,
): Promise<ReviewFinding[]> {
  try {
    const client = await getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are SCAN, an expert code reviewer. Review this PR diff and find issues.

PR: ${opts.prTitle}
Branch: ${opts.headBranch} → ${opts.baseBranch}
Changed files:
${filesSummary}

Diff:
\`\`\`
${diff}
\`\`\`

Review for:
1. Security vulnerabilities (SQL injection, XSS, auth bypass, secrets exposure)
2. Correctness (logic errors, edge cases, race conditions, null checks)
3. Type safety (unsafe casts, missing validation)
4. Performance (N+1 queries, unbounded loops, missing limits)

Respond with a JSON array of findings. Each finding must have:
- "path": exact file path from the diff (e.g. "apps/platform/src/lib/foo.ts")
- "line": the line number in the NEW file (from the @@ hunk header, + lines only)
- "body": clear description of the issue and how to fix it
- "severity": "critical" | "high" | "medium" | "low"

Only include real issues — no style nits or suggestions. If the code looks good, return an empty array.

Respond ONLY with the JSON array, no markdown fences or other text.`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    // Parse JSON, handling potential markdown fences
    const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const findings: ReviewFinding[] = JSON.parse(jsonStr);

    // Validate findings have valid file paths that exist in the diff
    const validPaths = new Set(
      diff
        .match(/^diff --git a\/(.+?) b\//gm)
        ?.map((m) => m.replace('diff --git a/', '').replace(/ b\/.*/, '')) ?? [],
    );

    return findings.filter(
      (f) =>
        f.path &&
        f.line > 0 &&
        f.body &&
        f.severity &&
        (validPaths.has(f.path) || validPaths.has(`a/${f.path}`)),
    );
  } catch (err) {
    console.error('[pr-auto-review] Code review failed:', err);
    return [];
  }
}

async function runDesignReview(
  uiDiff: string,
  uiFiles: string[],
  opts: AutoReviewOpts,
): Promise<string> {
  try {
    const client = await getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are NOIR, a design-focused code reviewer. Review UI changes in this PR.

PR: ${opts.prTitle}
UI files changed: ${uiFiles.join(', ')}

Diff:
\`\`\`
${uiDiff}
\`\`\`

Review for:
1. Design token usage (should use semantic tokens, not hardcoded colors)
2. Responsive design (mobile/desktop breakpoints)
3. Accessibility (aria labels, focus management, color contrast)
4. Loading/error/empty states handled
5. Dark theme compatibility
6. Component consistency with existing patterns

Format your response as a GitHub comment with:
- 🎨 **NOIR** — Design Feedback header
- Bullet points for each finding with severity emoji (🔴 critical, 🟠 high, 🟡 medium, ⚪ low)
- If everything looks good, say so
- End with "---" and "_Design review by celune[bot]_"

Keep it concise — max 10 findings.`,
        },
      ],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : '🎨 **NOIR** — Design review could not be generated.';
  } catch (err) {
    console.error('[pr-auto-review] Design review failed:', err);
    return '🎨 **NOIR** — Design review could not be completed.\n\n---\n_Design review by celune[bot]_';
  }
}

async function runPrSummary(
  diff: string,
  filesSummary: string,
  reviewDialog: string,
  opts: AutoReviewOpts,
): Promise<string> {
  try {
    const client = await getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are SAGE, a product-minded PR summarizer. You have access to the review dialog from SCAN and NOIR. Use their findings to inform your summary.

PR: ${opts.prTitle}
Branch: ${opts.headBranch} → ${opts.baseBranch}
Changes: ${opts.additions} additions, ${opts.deletions} deletions

Changed files:
${filesSummary}

${reviewDialog}

Diff (first 20K chars):
\`\`\`
${diff.slice(0, 20_000)}
\`\`\`

Write a GitHub comment with:
- 📝 **SAGE** — PR Summary header
- **What changed** — 2-3 bullet points describing the key changes (not just file lists)
- **Why it matters** — 1 sentence on the business/user impact
- **Risk assessment** — Low/Medium/High with brief justification (reference SCAN findings if any)
- **Review consensus** — Summarize what SCAN found (and NOIR if UI changes exist). Note any critical/high issues that need addressing before merge.
- **Retro notes** — 1-2 bullet points on patterns worth discussing in the project retrospective (e.g. recurring issues, architectural decisions, test coverage gaps)
- End with "---" and "_Summary by celune[bot]_"

Be concise and useful. Focus on the "what" and "why", not the "how".`,
        },
      ],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : '📝 **SAGE** — PR summary could not be generated.';
  } catch (err) {
    console.error('[pr-auto-review] PR summary failed:', err);
    return '📝 **SAGE** — Summary could not be completed.\n\n---\n_Summary by celune[bot]_';
  }
}

// ── Task creation from review findings ──────────────────────────────────

interface CreatedTask {
  id: string;
  title: string;
  severity: string;
  source: 'scan' | 'noir' | 'sage';
  status: 'inbox';
  projectName: string | null;
}

interface CreateTasksOpts {
  installationId: number;
  owner: string;
  repo: string;
  workspaceId: string;
  prNumber: number;
  prTitle: string;
  scanFindings: ReviewFinding[];
  designFeedback: string;
  hasUiChanges: boolean;
}

const SEVERITY_TO_PRIORITY: Record<string, string> = {
  critical: 'urgent',
  high: 'high',
  medium: 'normal',
  low: 'low',
};

async function createTasksFromFindings(opts: CreateTasksOpts): Promise<CreatedTask[]> {
  const {
    installationId,
    owner,
    repo,
    workspaceId,
    prNumber,
    prTitle,
    scanFindings,
    designFeedback,
    hasUiChanges,
  } = opts;
  const supabase = createServiceClient();
  const created: CreatedTask[] = [];

  try {
    // Get workspace org → owner for task ownership
    const { data: ws } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspaceId)
      .single();
    if (!ws?.org_id) return created;

    const { data: org } = await supabase
      .from('organizations')
      .select('owner_id')
      .eq('id', ws.org_id)
      .single();
    const userId = org?.owner_id;
    if (!userId) return created;

    // Find the project linked to this PR (if any)
    const { data: prLink } = await supabase
      .from('project_prs')
      .select('project_id, projects(name)')
      .eq('workspace_id', workspaceId)
      .eq('pr_number', prNumber)
      .maybeSingle();

    const projectId = prLink?.project_id ?? null;
    const projectName = (prLink?.projects as unknown as { name: string } | null)?.name ?? null;

    // Create tasks for critical + high SCAN findings
    for (let i = 0; i < scanFindings.length; i++) {
      const finding = scanFindings[i]!;
      if (finding.severity !== 'critical' && finding.severity !== 'high') continue;

      const title = `[PR #${prNumber}] ${finding.severity}: ${finding.body.slice(0, 55)}`;
      const description = `## What\nAuto-generated from PR #${prNumber} code review.\n\n**File:** \`${finding.path}:${finding.line}\`\n**Severity:** ${finding.severity}\n**Finding:** ${finding.body}\n\n## Source\nPR: ${prTitle}`;

      const { data: task } = await supabase
        .from('tasks')
        .insert({
          title: title.slice(0, 70),
          description,
          status: 'inbox',
          priority: SEVERITY_TO_PRIORITY[finding.severity] ?? 'normal',
          assignee: 'unassigned',
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          source: 'pr-review',
          source_ref: `PR #${prNumber}`,
        })
        .select('id')
        .single();

      if (task) {
        created.push({
          id: task.id,
          title: title.slice(0, 70),
          severity: finding.severity,
          source: 'scan',
          status: 'inbox',
          projectName,
        });

        // Task status shown in SAGE summary table (no inline replies to stay within timeout)
      }
    }

    // Create a single task for medium/low findings (grouped)
    const minorFindings = scanFindings
      .map((f, i) => ({ ...f, originalIndex: i }))
      .filter((f) => f.severity === 'medium' || f.severity === 'low');
    if (minorFindings.length > 0) {
      const title = `[PR #${prNumber}] Address ${minorFindings.length} code review findings`;
      const description = `## What\n${minorFindings.length} medium/low findings from PR #${prNumber} code review.\n\n${minorFindings.map((f) => `- **[${f.severity}]** \`${f.path}:${f.line}\` — ${f.body}`).join('\n')}\n\n## Source\nPR: ${prTitle}`;

      const { data: task } = await supabase
        .from('tasks')
        .insert({
          title: title.slice(0, 70),
          description,
          status: 'inbox',
          priority: 'normal',
          assignee: 'unassigned',
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          source: 'pr-review',
          source_ref: `PR #${prNumber}`,
        })
        .select('id')
        .single();

      if (task) {
        created.push({
          id: task.id,
          title: title.slice(0, 70),
          severity: 'medium',
          source: 'scan',
          status: 'inbox',
          projectName,
        });

        // Task status shown in SAGE summary table
      }
    }

    // Create task for design feedback if present
    if (hasUiChanges && designFeedback && designFeedback.length > 50) {
      const title = `[PR #${prNumber}] Address design feedback`;
      const description = `## What\nDesign feedback from NOIR on PR #${prNumber}.\n\n${designFeedback.slice(0, 2000)}\n\n## Source\nPR: ${prTitle}`;

      const { data: task } = await supabase
        .from('tasks')
        .insert({
          title: title.slice(0, 70),
          description,
          status: 'inbox',
          priority: 'normal',
          assignee: 'unassigned',
          project_id: projectId,
          workspace_id: workspaceId,
          user_id: userId,
          source: 'pr-review',
          source_ref: `PR #${prNumber}`,
        })
        .select('id')
        .single();

      if (task) {
        created.push({
          id: task.id,
          title: title.slice(0, 70),
          severity: 'medium',
          source: 'noir',
          status: 'inbox',
          projectName,
        });
      }
    }

    console.log(`[pr-auto-review] Created ${created.length} tasks from PR #${prNumber} review`);
  } catch (err) {
    console.error('[pr-auto-review] Failed to create tasks from findings:', err);
  }

  return created;
}

function buildTaskStatusTable(tasks: CreatedTask[]): string {
  if (tasks.length === 0) {
    return '### 📋 Follow-up Tasks\nNo tasks created — all findings are informational.';
  }

  const rows = tasks.map((t) => {
    const statusIcon = t.status === 'inbox' ? '📥' : t.status === 'done' ? '✅' : '🔄';
    const project = t.projectName ? `→ ${t.projectName}` : '→ Standalone';
    return `| ${statusIcon} ${t.status} | ${t.severity} | ${t.source.toUpperCase()} | ${t.title} | ${project} |`;
  });

  return [
    '### 📋 Follow-up Tasks',
    '',
    `${tasks.length} task(s) created from this review:`,
    '',
    '| Status | Severity | Source | Task | Project |',
    '|--------|----------|--------|------|---------|',
    ...rows,
    '',
    '_Tasks are in your project board. Critical/high findings get individual tasks; medium/low are grouped._',
  ].join('\n');
}
