/**
 * Config Drift Detection — workspace health monitoring.
 *
 * Detects when workspace brain configs diverge from platform defaults.
 * Computes a drift score based on forked files, stale configs, and
 * orphaned references.
 */

import { CORE_MANIFEST } from './brain-manifest-registry';

/** Individual drift finding */
export interface DriftFinding {
  /** Category of drift */
  type: 'forked' | 'stale' | 'orphaned' | 'missing';
  /** Path of the affected component */
  path: string;
  /** Severity: info, warning, or critical */
  severity: 'info' | 'warning' | 'critical';
  /** Human-readable explanation */
  message: string;
  /** Additional context */
  details?: Record<string, unknown>;
}

/** Result of a workspace drift analysis */
export interface DriftReport {
  /** Workspace being analyzed */
  workspace_id: string;
  /** Overall drift score (0-100, higher = more drift) */
  score: number;
  /** Drift category: healthy, drifting, degraded */
  status: 'healthy' | 'drifting' | 'degraded';
  /** Individual findings */
  findings: DriftFinding[];
  /** Summary counts */
  summary: {
    total_components: number;
    forked: number;
    stale: number;
    orphaned: number;
    missing: number;
  };
  /** Timestamp of analysis */
  analyzed_at: string;
}

/** Subset of BrainManifest fields needed for drift analysis */
type ManifestRow = Pick<
  import('@repo/types').BrainManifest,
  'path' | 'is_core' | 'is_forked' | 'update_available' | 'updated_at'
> & { ownership_scope?: string };

/**
 * Analyze a workspace's brain manifest for config drift.
 *
 * @param workspaceId - Workspace being analyzed
 * @param manifestRows - Current brain_manifest rows for the workspace
 * @param now - Current timestamp (for staleness calculation)
 * @param stalenessDays - Number of days before a config is considered stale (default 30)
 */
export function analyzeDrift(
  workspaceId: string,
  manifestRows: ManifestRow[],
  now: Date = new Date(),
  stalenessDays: number = 30,
): DriftReport {
  // Uninitialized workspace — no manifest rows means brain hasn't been bootstrapped yet
  if (manifestRows.length === 0) {
    return {
      workspace_id: workspaceId,
      score: 0,
      status: 'healthy',
      findings: [
        {
          type: 'missing',
          path: '*',
          severity: 'info',
          message: 'Workspace has not been bootstrapped yet. Run brain bootstrap to initialize.',
        },
      ],
      summary: {
        total_components: CORE_MANIFEST.length,
        forked: 0,
        stale: 0,
        orphaned: 0,
        missing: 0,
      },
      analyzed_at: now.toISOString(),
    };
  }

  const findings: DriftFinding[] = [];
  const corePathSet = new Set(CORE_MANIFEST.map((e) => e.path));
  const manifestPathSet = new Set(manifestRows.map((r) => r.path));

  let forkedCount = 0;
  let staleCount = 0;
  let orphanedCount = 0;
  let missingCount = 0;

  // 1. Check for forked files
  for (const row of manifestRows) {
    if (row.is_forked) {
      forkedCount++;
      findings.push({
        type: 'forked',
        path: row.path,
        severity: 'warning',
        message: `"${row.path}" has been modified from the core version`,
        details: { update_available: row.update_available },
      });
    }
  }

  // 2. Check for stale configs (not updated in stalenessDays+ days)
  const thirtyDaysAgo = new Date(now.getTime() - stalenessDays * 24 * 60 * 60 * 1000);
  for (const row of manifestRows) {
    if (row.is_core && !row.is_forked) {
      const updatedAt = new Date(row.updated_at);
      if (updatedAt < thirtyDaysAgo) {
        staleCount++;
        const daysSinceUpdate = Math.floor(
          (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        findings.push({
          type: 'stale',
          path: row.path,
          severity: daysSinceUpdate > 90 ? 'critical' : 'info',
          message: `"${row.path}" hasn't been updated in ${daysSinceUpdate} days`,
          details: { days_since_update: daysSinceUpdate, updated_at: row.updated_at },
        });
      }
    }
  }

  // 3. Check for orphaned entries (in workspace but not in core manifest)
  for (const row of manifestRows) {
    if (row.is_core && !corePathSet.has(row.path)) {
      orphanedCount++;
      findings.push({
        type: 'orphaned',
        path: row.path,
        severity: 'warning',
        message: `"${row.path}" exists in workspace but was removed from the core manifest`,
      });
    }
  }

  // 4. Check for missing core components
  for (const coreEntry of CORE_MANIFEST) {
    if (!manifestPathSet.has(coreEntry.path)) {
      missingCount++;
      findings.push({
        type: 'missing',
        path: coreEntry.path,
        severity: 'warning',
        message: `Core component "${coreEntry.path}" is missing from workspace`,
        details: { description: coreEntry.description, category: coreEntry.category },
      });
    }
  }

  // Compute drift score (0-100)
  const totalComponents = Math.max(CORE_MANIFEST.length, manifestRows.length);
  const weightedIssues = forkedCount * 3 + staleCount * 1 + orphanedCount * 5 + missingCount * 4;
  const score = Math.min(100, Math.round((weightedIssues / totalComponents) * 100));

  const status: DriftReport['status'] =
    score <= 10 ? 'healthy' : score <= 40 ? 'drifting' : 'degraded';

  return {
    workspace_id: workspaceId,
    score,
    status,
    findings,
    summary: {
      total_components: totalComponents,
      forked: forkedCount,
      stale: staleCount,
      orphaned: orphanedCount,
      missing: missingCount,
    },
    analyzed_at: now.toISOString(),
  };
}
