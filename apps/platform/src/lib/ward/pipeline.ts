/**
 * apps/platform/src/lib/ward/pipeline.ts
 *
 * WARD auto-fix execution pipeline. Orchestrates the stages:
 * INTAKE -> ANALYZE -> FIX -> REVIEW -> NOTIFY
 *
 * Each stage logs to activity_log for audit trail.
 * The FIX stage is a placeholder until Anthropic API integration.
 */

import { createServiceClient } from '@repo/db/service';
import {
  type WardConfig,
  DEFAULT_WARD_CONFIG,
  checkAutoFixEligibility,
  mapSeverityToPriority,
} from './config';
import { buildFixPrompt } from './prompts';
import { shouldProcess } from './dedup';
import { notifyFixReady } from './notify';

// ── Types ───────────────────────────────────────────────────────────────────

export type FixStage = 'intake' | 'analyze' | 'fix' | 'review' | 'notify';
export type FixStatus =
  | 'pending'
  | 'analyzing'
  | 'fixing'
  | 'awaiting_review'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'failed';

export interface WardError {
  title: string;
  culprit: string;
  level: string;
  sentryUrl?: string;
  projectSlug?: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
}

export interface WardFix {
  id: string;
  errorId: string;
  stage: FixStage;
  status: FixStatus;
  workspaceId: string;
  error: WardError;
  priority: string;
  fix?: {
    description: string;
    diff?: string;
    branch?: string;
    prUrl?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// ── Activity logging ────────────────────────────────────────────────────────

async function logActivity(
  eventType: string,
  title: string,
  details: Record<string, unknown>,
  severity: 'info' | 'warning' | 'error' | 'critical' = 'info',
  workspaceId?: string,
): Promise<void> {
  try {
    // Service client: logs WARD pipeline events. Accesses: activity_log.
    const supabase = createServiceClient();
    const { error } = await supabase.from('activity_log').insert({
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      event_type: eventType,
      severity,
      source: 'ward-pipeline',
      title: title.slice(0, 200),
      details: JSON.stringify(details),
    });

    if (error) {
      console.error(`[ward-pipeline] Failed to log activity: ${error.message}`);
    }
  } catch (err) {
    console.error('[ward-pipeline] Activity logging error:', err);
  }
}

// ── Pipeline stages ─────────────────────────────────────────────────────────

/**
 * INTAKE: Validate the error and check dedup/rate limits.
 */
async function intake(
  workspaceId: string,
  errorId: string,
  error: WardError,
  config: WardConfig,
): Promise<WardFix | null> {
  const fingerprint = `${error.title}::${error.culprit}`;
  const dedupResult = await shouldProcess(workspaceId, fingerprint, config);

  if (!dedupResult.allowed) {
    await logActivity(
      'ward.intake_skipped',
      `Skipped: ${error.title}`,
      {
        error_id: errorId,
        reason: dedupResult.reason,
      },
      'info',
      workspaceId,
    );
    return null;
  }

  const now = new Date().toISOString();
  const fix: WardFix = {
    id: `ward_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    errorId,
    stage: 'intake',
    status: 'pending',
    workspaceId,
    error,
    priority: mapSeverityToPriority(error.level),
    createdAt: now,
    updatedAt: now,
  };

  await logActivity(
    'ward.intake',
    `Intake: ${error.title}`,
    {
      fix_id: fix.id,
      error_id: errorId,
      priority: fix.priority,
    },
    'info',
    workspaceId,
  );

  return fix;
}

/**
 * ANALYZE: Check eligibility and prepare the fix prompt.
 */
async function analyze(fix: WardFix, config: WardConfig): Promise<WardFix | null> {
  fix.stage = 'analyze';
  fix.status = 'analyzing';
  fix.updatedAt = new Date().toISOString();

  const eligibility = checkAutoFixEligibility(config, {
    level: fix.error.level,
    projectSlug: fix.error.projectSlug,
    culprit: fix.error.culprit,
  });

  if (!eligibility.eligible) {
    fix.status = 'failed';
    await logActivity(
      'ward.analyze_ineligible',
      `Ineligible: ${fix.error.title}`,
      { fix_id: fix.id, reason: eligibility.reason },
      'warning',
      fix.workspaceId,
    );
    return null;
  }

  // Build the prompt (will be sent to AI in future sprint)
  const _prompt = buildFixPrompt({
    title: fix.error.title,
    culprit: fix.error.culprit,
    stackTrace: fix.error.stackTrace,
    metadata: fix.error.metadata,
  });

  await logActivity(
    'ward.analyze_complete',
    `Analyzed: ${fix.error.title}`,
    {
      fix_id: fix.id,
      priority: fix.priority,
      prompt_length: _prompt.length,
    },
    'info',
    fix.workspaceId,
  );

  return fix;
}

/**
 * FIX: Generate the fix using AI.
 * Currently a placeholder — logs intent but does not call AI.
 */
async function generateFix(fix: WardFix): Promise<WardFix> {
  fix.stage = 'fix';
  fix.status = 'fixing';
  fix.updatedAt = new Date().toISOString();

  // Anthropic API integration pending — log intent and mark as awaiting review.
  await logActivity(
    'ward.fix_placeholder',
    `Fix generation pending AI integration: ${fix.error.title}`,
    {
      fix_id: fix.id,
      error_id: fix.errorId,
      note: 'AI fix generation not yet implemented — requires Anthropic API integration',
    },
    'info',
    fix.workspaceId,
  );

  fix.status = 'awaiting_review';
  return fix;
}

/**
 * REVIEW: Check if approval is required. If so, mark as awaiting review.
 */
async function review(fix: WardFix, config: WardConfig): Promise<WardFix> {
  fix.stage = 'review';
  fix.updatedAt = new Date().toISOString();

  if (config.requireApproval) {
    fix.status = 'awaiting_review';
    await logActivity(
      'ward.review_pending',
      `Awaiting approval: ${fix.error.title}`,
      {
        fix_id: fix.id,
        require_approval: true,
      },
      'info',
      fix.workspaceId,
    );
  } else {
    // Auto-approve when approval is not required
    fix.status = 'approved';
    await logActivity(
      'ward.review_auto_approved',
      `Auto-approved: ${fix.error.title}`,
      {
        fix_id: fix.id,
        require_approval: false,
      },
      'info',
      fix.workspaceId,
    );
  }

  return fix;
}

/**
 * NOTIFY: Send Slack notification with merge/reject buttons.
 */
async function notify(fix: WardFix, config: WardConfig): Promise<WardFix> {
  fix.stage = 'notify';
  fix.updatedAt = new Date().toISOString();

  const result = await notifyFixReady({
    workspaceId: fix.workspaceId,
    fix,
    config,
  });

  if (result.success) {
    await logActivity(
      'ward.notify_sent',
      `Notification sent: ${fix.error.title}`,
      {
        fix_id: fix.id,
        status: fix.status,
      },
      'info',
      fix.workspaceId,
    );
  } else {
    await logActivity(
      'ward.notify_failed',
      `Notification failed: ${fix.error.title}`,
      {
        fix_id: fix.id,
        status: fix.status,
        error: result.error,
      },
      'warning',
      fix.workspaceId,
    );
  }

  return fix;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Process a Sentry error through the full WARD pipeline.
 *
 * Returns the WardFix if processing completed, or null if the error was
 * skipped (dedup, rate limit, ineligible).
 */
export async function processError(
  workspaceId: string,
  errorId: string,
  error: WardError,
  config: WardConfig = DEFAULT_WARD_CONFIG,
): Promise<WardFix | null> {
  try {
    // Stage 1: Intake
    const fix = await intake(workspaceId, errorId, error, config);
    if (!fix) return null;

    // Stage 2: Analyze
    const analyzed = await analyze(fix, config);
    if (!analyzed) return null;

    // Stage 3: Fix (placeholder)
    const fixed = await generateFix(analyzed);

    // Stage 4: Review
    const reviewed = await review(fixed, config);

    // Stage 5: Notify
    const notified = await notify(reviewed, config);

    return notified;
  } catch (err) {
    console.error('[ward-pipeline] Pipeline error:', err);
    await logActivity(
      'ward.pipeline_error',
      `Pipeline error for ${error.title}`,
      {
        error_id: errorId,
        error_message: err instanceof Error ? err.message : String(err),
      },
      'error',
      workspaceId,
    );
    return null;
  }
}
