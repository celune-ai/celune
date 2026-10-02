/**
 * POST /api/cron/run
 *
 * Vercel Cron trigger endpoint. Executes registered jobs from the cron_jobs table.
 * Auth: requires CRON_SECRET Bearer token.
 *
 * Registered handlers:
 * - heartbeat_check: detect stale agents, reset to idle, fire alerts
 * - health_check: run system health checks
 * - heartbeat_digest: daily digest (placeholder)
 * - memory_ingest: auto-create memories from high-signal activity events
 * - knowledge_source_crawl: crawl active knowledge sources and store chunks
 * - ward_fix_log_cleanup: purge expired WARD dedup entries
 * - vault_sync: sync Obsidian vault files to agent_memory via .celune-sync allowlist
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { timingSafeEqual } from 'crypto';
import { checkWorkspaceHeartbeats, sendSlackHeartbeatAlert } from '@/lib/heartbeat-alerts';
import { ingestWorkspaceMemories } from '@/lib/memory-ingestion';
import { crawlKnowledgeSource } from '@/lib/crawl-pipeline';
import { syncVault } from '@/lib/vault-sync';

export const dynamic = 'force-dynamic';

interface CronJob {
  job_id: string;
  workspace_id: string | null;
  display_name: string;
  schedule_seconds: number | null;
  last_run_at: string | null;
  enabled: boolean;
}

interface JobResult {
  job_id: string;
  status: 'success' | 'failure' | 'skipped';
  details?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

type JobHandler = (
  supabase: ReturnType<typeof createServiceClient>,
  job: CronJob,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any>;

const JOB_HANDLERS: Record<string, JobHandler> = {
  heartbeat_check: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };

    // Read workspace heartbeat config for custom thresholds
    const { data: ws } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', job.workspace_id)
      .single();

    const config = (ws?.metadata as Record<string, unknown>)?.heartbeat_config as
      Record<string, unknown> | undefined;
    // Clamp values to safe bounds to prevent alert storms from malformed config
    const rawPingSeconds = (config?.ping_interval_seconds as number) ?? 30;
    const pingInterval = Math.max(10, Math.min(300, rawPingSeconds)) * 1000;
    const rawMultiplier = (config?.stale_threshold_multiplier as number) ?? 3;
    const staleMultiplier = Math.max(2, Math.min(10, rawMultiplier));
    const staleThresholdMs = pingInterval * staleMultiplier;

    const result = await checkWorkspaceHeartbeats(supabase, job.workspace_id, staleThresholdMs);

    // Send Slack alert if agents were reset
    if (result.staleAgents.length > 0) {
      const slackSent = await sendSlackHeartbeatAlert(
        supabase,
        job.workspace_id,
        result.staleAgents,
      );
      return { ...result, slackSent };
    }

    return result;
  },

  health_check: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };

    // Basic health check: verify agent_status table is responsive
    const { count, error } = await supabase
      .from('agent_status')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', job.workspace_id);

    if (error) {
      return { status: 'degraded', detail: 'agent_status query failed' };
    }

    return { status: 'healthy', agent_count: count ?? 0 };
  },

  memory_archival: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };

    // Archive cold memories: low hotness (access_count=0 or very low) + older than 7 days
    // Excludes core memories and already-archived ones
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: coldMemories, error: fetchErr } = await supabase
      .from('agent_memory')
      .select('id')
      .eq('workspace_id', job.workspace_id)
      .eq('is_archived', false)
      .eq('is_core', false)
      .lt('updated_at', sevenDaysAgo)
      .or('access_count.is.null,access_count.lte.1')
      .limit(500);

    if (fetchErr) throw fetchErr;
    if (!coldMemories || coldMemories.length === 0) {
      return { status: 'success', archived: 0 };
    }

    const ids = coldMemories.map((m: { id: string }) => m.id);
    const { error: updateErr } = await supabase
      .from('agent_memory')
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (updateErr) throw updateErr;

    return { status: 'success', archived: ids.length };
  },

  heartbeat_digest: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };

    // Daily digest: summarize each agent's activity and store in agent_memory
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = yesterday.toISOString().split('T')[0];

    const { data: events } = await supabase
      .from('heartbeat_events')
      .select('agent_id, event_type, created_at')
      .eq('workspace_id', job.workspace_id)
      .gte('created_at', yesterday.toISOString())
      .lt('created_at', today.toISOString());

    if (!events || events.length === 0) {
      return { status: 'no_events', date: dateStr };
    }

    // Group by agent
    const byAgent = new Map<string, typeof events>();
    for (const e of events) {
      const list = byAgent.get(e.agent_id) ?? [];
      list.push(e);
      byAgent.set(e.agent_id, list);
    }

    let memoriesWritten = 0;

    for (const [agentId, agentEvents] of byAgent) {
      const sessions = agentEvents.filter((e) => e.event_type === 'task_started').length;
      const completions = agentEvents.filter((e) => e.event_type === 'task_completed').length;
      const staleResets = agentEvents.filter((e) => e.event_type === 'stale_reset').length;
      const totalEvents = agentEvents.length;

      const content = `Agent ${agentId} daily summary for ${dateStr}: ${sessions} task sessions started, ${completions} completed, ${staleResets} stale resets. Total heartbeat events: ${totalEvents}.`;

      // Upsert daily digest memory
      const { error } = await supabase.from('agent_memory').upsert(
        {
          key: `heartbeat-digest:${agentId}:${dateStr}`,
          content,
          category: 'context',
          memory_type: 'context',
          source: 'heartbeat',
          importance_score: 0.4,
          workspace_id: job.workspace_id,
          agent_id: agentId,
        },
        { onConflict: 'key' },
      );

      if (!error) memoriesWritten++;
    }

    return {
      status: 'success',
      date: dateStr,
      agents: byAgent.size,
      memories_written: memoriesWritten,
    };
  },

  ward_fix_log_cleanup: async (supabase) => {
    // Purge expired WARD dedup entries (older than 1 hour) to allow re-processing
    const { data, error } = await supabase.rpc('cleanup_ward_fix_log', { ttl_hours: 1 });
    if (error) throw error;
    return { status: 'success', deleted: data ?? 0 };
  },

  knowledge_source_crawl: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };

    // Find active knowledge sources due for re-crawl
    const { data: sources, error: srcErr } = await supabase
      .from('knowledge_sources')
      .select('id, source_type, url, crawl_config, last_crawled_at')
      .eq('workspace_id', job.workspace_id)
      .eq('is_active', true)
      .in('status', ['pending', 'complete'])
      .order('last_crawled_at', { ascending: true, nullsFirst: true })
      .limit(20);

    if (srcErr) throw srcErr;
    if (!sources || sources.length === 0) {
      return { status: 'success', crawled: 0, reason: 'no_active_sources' };
    }

    // Read workspace brain_settings for crawl interval
    const { data: ws } = await supabase
      .from('workspaces')
      .select('brain_settings')
      .eq('id', job.workspace_id)
      .single();
    const brainSettings = (ws?.brain_settings ?? {}) as Record<string, unknown>;
    const intervalHours = (brainSettings.auto_crawl_interval_hours as number) ?? 24;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    let crawled = 0;
    const errors: string[] = [];

    for (const source of sources) {
      // Skip if recently crawled
      if (source.last_crawled_at) {
        const elapsed = Date.now() - new Date(source.last_crawled_at).getTime();
        if (elapsed < intervalMs) continue;
      }

      // Mark as crawling
      await supabase.from('knowledge_sources').update({ status: 'crawling' }).eq('id', source.id);

      const config = (source.crawl_config ?? {}) as Record<string, unknown>;
      const result = await crawlKnowledgeSource(
        supabase,
        source.id,
        job.workspace_id,
        source.source_type,
        source.url,
        config,
      );

      // Update source with results
      await supabase
        .from('knowledge_sources')
        .update({
          status: result.errors.length > 0 && result.pages_crawled === 0 ? 'failed' : 'complete',
          last_crawled_at: new Date().toISOString(),
          last_error: result.errors.length > 0 ? result.errors.join('; ') : null,
          pages_crawled: result.pages_crawled,
          chunks_created: result.chunks_created,
          updated_at: new Date().toISOString(),
        })
        .eq('id', source.id);

      crawled++;
      if (result.errors.length > 0) errors.push(...result.errors);
    }

    return {
      status: errors.length > 0 ? 'partial' : 'success',
      crawled,
      errors: errors.length > 0 ? errors : undefined,
    };
  },

  memory_ingest: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };
    const result = await ingestWorkspaceMemories(supabase, job.workspace_id);
    return {
      status: result.errors.length > 0 ? 'partial' : 'success',
      processed: result.processed,
      memories_created: result.memoriesCreated,
      memories_updated: result.memoriesUpdated,
      skipped: result.skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  },

  vault_sync: async (supabase, job) => {
    if (!job.workspace_id) return { skipped: true, reason: 'no workspace_id' };

    // Find active vault sync sources for this workspace
    const { data: sources, error: srcErr } = await supabase
      .from('vault_sync_sources')
      .select('id, vault_path, file_hashes, last_synced_at')
      .eq('workspace_id', job.workspace_id)
      .in('status', ['pending', 'complete', 'failed'])
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(5);

    if (srcErr) throw srcErr;
    if (!sources || sources.length === 0) {
      return { status: 'success', synced: 0, reason: 'no_vault_sources' };
    }

    let synced = 0;
    const errors: string[] = [];

    for (const source of sources) {
      // Mark as syncing
      await supabase.from('vault_sync_sources').update({ status: 'syncing' }).eq('id', source.id);

      try {
        const storedHashes = (source.file_hashes ?? {}) as Record<string, string>;
        const result = await syncVault(
          supabase,
          job.workspace_id!,
          source.vault_path,
          storedHashes,
        );

        synced++;
        if (result.errors.length > 0) errors.push(...result.errors);
      } catch (err) {
        // Reset status so this source isn't permanently stuck as 'syncing'
        const errMsg = err instanceof Error ? err.message : String(err);
        await supabase
          .from('vault_sync_sources')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', source.id);
        errors.push(`vault ${source.vault_path}: ${errMsg}`);
      }
    }

    return {
      status: errors.length > 0 ? 'partial' : 'success',
      synced,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    // Require CRON_SECRET for auth
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${cronSecret}`;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const now = new Date();

    // Fetch all enabled cron jobs
    const { data: jobs, error: fetchError } = await supabase
      .from('cron_jobs')
      .select('job_id, workspace_id, display_name, schedule_seconds, last_run_at, enabled')
      .eq('enabled', true);

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to fetch cron jobs' }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ executed: 0, message: 'No enabled cron jobs' });
    }

    const results: JobResult[] = [];

    for (const job of jobs as CronJob[]) {
      // Check if job is due (past its schedule interval)
      if (job.last_run_at && job.schedule_seconds) {
        const elapsed = now.getTime() - new Date(job.last_run_at).getTime();
        if (elapsed < job.schedule_seconds * 1000) {
          results.push({ job_id: job.job_id, status: 'skipped', details: { reason: 'not_due' } });
          continue;
        }
      }

      // Extract handler name from job_id (format: "handler_name:workspace_id")
      const handlerName = job.job_id.split(':')[0] ?? job.job_id;
      const handler = JOB_HANDLERS[handlerName];

      if (!handler) {
        results.push({
          job_id: job.job_id,
          status: 'skipped',
          details: { reason: 'no_handler' },
        });
        continue;
      }

      // Mark as running
      await supabase
        .from('cron_jobs')
        .update({ last_run_status: 'running', last_run_at: now.toISOString() })
        .eq('job_id', job.job_id);

      try {
        const details = await handler(supabase, job);

        await supabase
          .from('cron_jobs')
          .update({ last_run_status: 'success', last_error: null })
          .eq('job_id', job.job_id);

        results.push({ job_id: job.job_id, status: 'success', details });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        await supabase
          .from('cron_jobs')
          .update({ last_run_status: 'failure', last_error: errorMsg })
          .eq('job_id', job.job_id);

        results.push({ job_id: job.job_id, status: 'failure', error: errorMsg });
      }
    }

    return NextResponse.json({
      executed: results.filter((r) => r.status === 'success').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failure').length,
      results,
    });
  } catch (err) {
    console.error('[cron/run] fatal error:', err);
    return NextResponse.json({ error: 'Cron execution failed' }, { status: 500 });
  }
}
