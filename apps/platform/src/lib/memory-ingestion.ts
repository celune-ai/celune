/**
 * Memory Ingestion Service
 *
 * Observes platform activity and creates memories automatically.
 * Designed to run as a cron job via the existing cron_jobs infrastructure.
 *
 * Flow:
 * 1. Fetch unprocessed activity_log entries (memory_processed_at IS NULL)
 * 2. Run through the activity-to-memory mapper
 * 3. Filter for high-signal candidates
 * 4. Upsert memories via existing agent_memory upsert (dedup by key)
 * 5. Mark activity entries as processed
 */

import { createServiceClient } from '@repo/db/service';
import { mapActivitiesToMemories, filterByRelevance } from './memory-mapper';
import type { MemoryCandidate } from './memory-mapper';
import { generateAbstract, fireAndForgetEmbedding } from './memory-helpers';

type SupabaseClient = ReturnType<typeof createServiceClient>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Maximum activity entries to process per run to avoid long-running jobs */
const BATCH_SIZE = 200;

/** Minimum relevance threshold for creating memories */
const RELEVANCE_THRESHOLD = 0.5;

/** Maximum memories to create per run to avoid spamming */
const MAX_MEMORIES_PER_RUN = 50;

// ---------------------------------------------------------------------------
// Core ingestion
// ---------------------------------------------------------------------------

export interface IngestionResult {
  processed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  skipped: number;
  errors: string[];
}

/**
 * Run the memory ingestion pipeline for a specific workspace.
 */
export async function ingestWorkspaceMemories(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<IngestionResult> {
  const result: IngestionResult = {
    processed: 0,
    memoriesCreated: 0,
    memoriesUpdated: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Fetch unprocessed activity entries
  const { data: activities, error: fetchErr } = await supabase
    .from('activity_log')
    .select(
      'id, event_type, severity, source, title, details, task_id, agent_id, actor_user_id, workspace_id, created_at',
    )
    .eq('workspace_id', workspaceId)
    .is('memory_processed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    result.errors.push(`Failed to fetch activities: ${fetchErr.message}`);
    return result;
  }

  if (!activities || activities.length === 0) {
    return result;
  }

  result.processed = activities.length;

  // 2. Map to memory candidates
  const candidates = mapActivitiesToMemories(activities);

  // 3. Filter by relevance
  const filtered = filterByRelevance(candidates, RELEVANCE_THRESHOLD);
  result.skipped = candidates.length - filtered.length;

  // 4. Cap to prevent memory spam
  const toCreate = filtered.slice(0, MAX_MEMORIES_PER_RUN);

  // 5. Create/upsert memories
  for (const candidate of toCreate) {
    try {
      await upsertMemoryFromCandidate(supabase, candidate);
      result.memoriesCreated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't fail the whole batch for one bad memory
      if (msg.includes('immutable')) {
        result.memoriesUpdated++; // existed as episode, skip
      } else {
        result.errors.push(`Memory ${candidate.key}: ${msg}`);
      }
    }
  }

  // 6. Mark ALL fetched activities as processed (even those that didn't produce memories)
  const activityIds = activities.map((a: { id: string }) => a.id);
  await markActivitiesProcessed(supabase, activityIds);

  return result;
}

/**
 * Run ingestion across all workspaces that have unprocessed activities.
 */
export async function ingestAllWorkspaces(
  supabase: SupabaseClient,
): Promise<{ workspaces: number; total: IngestionResult }> {
  // Find distinct workspace_ids with unprocessed activities
  const { data: workspaces, error } = await supabase
    .from('activity_log')
    .select('workspace_id')
    .is('memory_processed_at', null)
    .not('workspace_id', 'is', null)
    .limit(500);

  if (error || !workspaces) {
    return {
      workspaces: 0,
      total: {
        processed: 0,
        memoriesCreated: 0,
        memoriesUpdated: 0,
        skipped: 0,
        errors: [error?.message ?? 'No workspaces found'],
      },
    };
  }

  // Deduplicate workspace IDs
  const wsIds = [
    ...new Set(workspaces.map((w: { workspace_id: string }) => w.workspace_id as string)),
  ];

  const total: IngestionResult = {
    processed: 0,
    memoriesCreated: 0,
    memoriesUpdated: 0,
    skipped: 0,
    errors: [],
  };

  // Process workspaces in parallel batches of 5 to avoid overwhelming the DB
  const CONCURRENCY = 5;
  for (let i = 0; i < wsIds.length; i += CONCURRENCY) {
    const batch = wsIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((wsId) => ingestWorkspaceMemories(supabase, wsId)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        total.processed += result.value.processed;
        total.memoriesCreated += result.value.memoriesCreated;
        total.memoriesUpdated += result.value.memoriesUpdated;
        total.skipped += result.value.skipped;
        total.errors.push(...result.value.errors);
      } else {
        total.errors.push(
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        );
      }
    }
  }

  return { workspaces: wsIds.length, total };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertMemoryFromCandidate(
  supabase: SupabaseClient,
  candidate: MemoryCandidate,
): Promise<void> {
  const abstract = generateAbstract(candidate.content);

  const row = {
    workspace_id: candidate.workspace_id,
    key: candidate.key,
    content: candidate.content,
    abstract,
    category: candidate.category,
    memory_type: candidate.memory_type,
    source: candidate.source,
    tags: candidate.tags,
    importance_score: candidate.importance_score,
    user_id: candidate.user_id,
    agent_id: candidate.agent_id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('agent_memory')
    .upsert(row, { onConflict: 'workspace_id,key', ignoreDuplicates: false })
    .select('id')
    .single();

  if (error) throw error;

  // Fire-and-forget embedding generation
  if (data?.id) {
    fireAndForgetEmbedding(supabase, data.id, candidate.content);
  }
}

async function markActivitiesProcessed(
  supabase: SupabaseClient,
  activityIds: string[],
): Promise<void> {
  if (activityIds.length === 0) return;

  const now = new Date().toISOString();

  // Process in chunks of 100 to avoid oversized IN clauses
  for (let i = 0; i < activityIds.length; i += 100) {
    const chunk = activityIds.slice(i, i + 100);
    await supabase.from('activity_log').update({ memory_processed_at: now }).in('id', chunk);
  }
}
