/**
 * Instructions cache for MCP server.
 *
 * Avoids re-querying onboarding memories on every MCP request.
 * 60-second TTL per workspace:user pair, LRU eviction at 200 entries.
 */

import type { AuthContext } from '@celuneai/api';
import { createServiceClient } from '@repo/db/service';

interface CacheEntry {
  instructions: string;
  expiresAt: number;
  lastAccess: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_SIZE = 200;

/** Evict expired entries first, then least-recently-accessed if still over limit. */
function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHE_SIZE) return;

  const now = Date.now();

  // Pass 1: remove expired
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size <= MAX_CACHE_SIZE) return;

  // Pass 2: evict least-recently-accessed until under limit
  const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  const toEvict = sorted.length - MAX_CACHE_SIZE;
  for (let i = 0; i < toEvict; i++) {
    cache.delete(sorted[i][0]);
  }
}

export async function getInstructions(ctx: AuthContext): Promise<string> {
  const cacheKey = `${ctx.workspaceId}:${ctx.userId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    cached.lastAccess = Date.now();
    return cached.instructions;
  }

  const supabase = createServiceClient();
  const { workspaceId, userId } = ctx;

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', workspaceId)
    .single();

  const { data: memories } = await supabase
    .from('agent_memory')
    .select('key, content, category')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .like('source', '%onboarding%')
    .order('importance_score', { ascending: false })
    .limit(20);

  const [taskResult, projectResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
  ]);

  const taskCount = taskResult.count ?? 0;
  const projectCount = projectResult.count ?? 0;
  const workspaceName = workspace?.name ?? 'their workspace';

  let instructions: string;

  if (memories && memories.length > 0) {
    const memorySummary = memories
      .map((m) => {
        const cleanKey = m.key.replace(/^onboarding:/, '');
        return `- ${cleanKey}: ${m.content}`;
      })
      .join('\n');

    instructions = `You are connected to ${workspaceName} on Celune. Here's what you know about this user from their onboarding conversation:\n\n${memorySummary}\n\nTheir workspace has ${projectCount} project${projectCount !== 1 ? 's' : ''} and ${taskCount} task${taskCount !== 1 ? 's' : ''}.`;
  } else {
    instructions = `You are connected to ${workspaceName} on Celune. This user hasn't completed onboarding yet — call the \`whoami\` tool to learn about them and their workspace. Their workspace has ${projectCount} project${projectCount !== 1 ? 's' : ''} and ${taskCount} task${taskCount !== 1 ? 's' : ''}.`;
  }

  const now = Date.now();
  cache.set(cacheKey, {
    instructions,
    expiresAt: now + CACHE_TTL_MS,
    lastAccess: now,
  });

  evictIfNeeded();

  return instructions;
}
