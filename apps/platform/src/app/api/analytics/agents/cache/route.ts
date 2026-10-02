import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { AGENT_COLORS } from '@/lib/agents-data';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * Per-agent prompt cache performance metrics.
 *
 * Cache hit rate = cache_read_tokens / (input_tokens + cache_read_tokens)
 * Cache creation rate = cache_creation_tokens / (input_tokens + cache_read_tokens)
 *
 * These metrics validate whether the stable-prefix prompt strategy
 * (Identity → Rules → Process → Task) is actually caching.
 */
export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    let query = supabase
      .from('claude_usage')
      .select(
        'agent_name, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd',
      )
      .not('agent_name', 'is', null);
    if (workspace_ids && workspace_ids.length > 0) {
      query = query.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      query = query.eq('workspace_id', workspace_id);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Aggregate per-agent
    const agentMap = new Map<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        totalCostUsd: number;
        requests: number;
      }
    >();

    for (const row of data ?? []) {
      const agent = row.agent_name as string;
      const existing = agentMap.get(agent) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
        requests: 0,
      };
      agentMap.set(agent, {
        inputTokens: existing.inputTokens + (row.input_tokens ?? 0),
        outputTokens: existing.outputTokens + (row.output_tokens ?? 0),
        cacheReadTokens: existing.cacheReadTokens + (row.cache_read_tokens ?? 0),
        cacheCreationTokens: existing.cacheCreationTokens + (row.cache_creation_tokens ?? 0),
        totalCostUsd: existing.totalCostUsd + Number(row.total_cost_usd ?? 0),
        requests: existing.requests + 1,
      });
    }

    // Cost saved per token: assume $3/M for input, $0.30/M for cache read
    const INPUT_PRICE_PER_TOKEN = 3.0 / 1_000_000;
    const CACHE_READ_PRICE_PER_TOKEN = 0.3 / 1_000_000;
    const SAVINGS_PER_CACHE_READ_TOKEN = INPUT_PRICE_PER_TOKEN - CACHE_READ_PRICE_PER_TOKEN;

    const agents = Array.from(agentMap.entries())
      .map(([agentId, metrics]) => {
        const totalInputBudget = metrics.inputTokens + metrics.cacheReadTokens;
        const hitRate =
          totalInputBudget > 0 ? Math.round((metrics.cacheReadTokens / totalInputBudget) * 100) : 0;
        const creationRate =
          totalInputBudget > 0
            ? Math.round((metrics.cacheCreationTokens / totalInputBudget) * 100)
            : 0;
        const estimatedSavings =
          Math.round(metrics.cacheReadTokens * SAVINGS_PER_CACHE_READ_TOKEN * 10000) / 10000;

        const color = AGENT_COLORS[agentId];

        return {
          agent: agentId,
          label: labels[agentId] ?? agentId,
          color: color?.hex ?? '#6B7280',
          requests: metrics.requests,
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          cacheReadTokens: metrics.cacheReadTokens,
          cacheCreationTokens: metrics.cacheCreationTokens,
          totalCostUsd: Math.round(metrics.totalCostUsd * 10000) / 10000,
          hitRate, // % of input budget served from cache
          creationRate, // % of input budget used to prime cache
          estimatedSavings, // USD saved vs. re-sending all tokens as fresh input
        };
      })
      .sort((a, b) => b.hitRate - a.hitRate);

    // System-wide totals
    let totalInput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalSavings = 0;

    for (const a of agents) {
      totalInput += a.inputTokens;
      totalCacheRead += a.cacheReadTokens;
      totalCacheCreation += a.cacheCreationTokens;
      totalSavings += a.estimatedSavings;
    }

    const totalBudget = totalInput + totalCacheRead;
    const systemHitRate = totalBudget > 0 ? Math.round((totalCacheRead / totalBudget) * 100) : 0;

    return cachedJson(
      {
        systemHitRate,
        totalCacheReadTokens: totalCacheRead,
        totalCacheCreationTokens: totalCacheCreation,
        totalInputTokens: totalInput,
        totalEstimatedSavings: Math.round(totalSavings * 10000) / 10000,
        agents,
      },
      15,
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
