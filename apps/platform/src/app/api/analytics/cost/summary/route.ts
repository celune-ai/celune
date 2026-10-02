import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { safeErrorResponse } from '@/lib/api-error';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Workspace scope is required
    const wsScope = await requireWorkspaceScope(request);
    if (wsScope instanceof NextResponse) return wsScope;

    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    const days = Math.min(Math.max(parseInt(daysParam ?? '30', 10) || 30, 7), 90);
    const workspace_id = wsScope.workspace_id;
    const workspace_ids = wsScope.workspace_ids;

    // Build all queries upfront, apply workspace filter, then run in parallel
    let dailyQuery = supabase
      .from('claude_usage_daily')
      .select(
        'day, model, agent_name, workspace_id, request_count, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd',
      )
      .order('day', { ascending: false })
      .limit(days);
    let agentQuery = supabase
      .from('claude_usage')
      .select('agent_name, total_cost_usd, input_tokens, output_tokens');
    let modelQuery = supabase
      .from('claude_usage')
      .select('model, total_cost_usd, input_tokens, output_tokens');

    if (workspace_ids && workspace_ids.length > 0) {
      dailyQuery = dailyQuery.in('workspace_id', workspace_ids);
      agentQuery = agentQuery.in('workspace_id', workspace_ids);
      modelQuery = modelQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      dailyQuery = dailyQuery.eq('workspace_id', workspace_id);
      agentQuery = agentQuery.eq('workspace_id', workspace_id);
      modelQuery = modelQuery.eq('workspace_id', workspace_id);
    }

    const [
      { data: daily, error: dailyError },
      { data: byAgent, error: agentError },
      { data: byModelRaw, error: modelError },
    ] = await Promise.all([dailyQuery, agentQuery, modelQuery]);

    if (dailyError) throw dailyError;
    if (agentError) throw agentError;
    if (modelError) throw modelError;

    // Aggregate per-agent in JS
    const agentMap = new Map<
      string,
      { total_cost_usd: number; input_tokens: number; output_tokens: number; request_count: number }
    >();
    for (const row of byAgent ?? []) {
      const key = (row.agent_name as string) ?? 'unknown';
      const existing = agentMap.get(key) ?? {
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        request_count: 0,
      };
      agentMap.set(key, {
        total_cost_usd: existing.total_cost_usd + (row.total_cost_usd as number),
        input_tokens: existing.input_tokens + (row.input_tokens as number),
        output_tokens: existing.output_tokens + (row.output_tokens as number),
        request_count: existing.request_count + 1,
      });
    }
    const byAgentSummary = Array.from(agentMap.entries())
      .map(([agent_name, totals]) => ({ agent_name, ...totals }))
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    // Aggregate per-model in JS
    const modelMap = new Map<
      string,
      { total_cost_usd: number; input_tokens: number; output_tokens: number; request_count: number }
    >();
    for (const row of byModelRaw ?? []) {
      const key = row.model as string;
      const existing = modelMap.get(key) ?? {
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        request_count: 0,
      };
      modelMap.set(key, {
        total_cost_usd: existing.total_cost_usd + (row.total_cost_usd as number),
        input_tokens: existing.input_tokens + (row.input_tokens as number),
        output_tokens: existing.output_tokens + (row.output_tokens as number),
        request_count: existing.request_count + 1,
      });
    }
    const byModelSummary = Array.from(modelMap.entries())
      .map(([model, totals]) => ({ model, ...totals }))
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    // Overall totals
    const totals = (byModelRaw ?? []).reduce(
      (
        acc: {
          total_cost_usd: number;
          input_tokens: number;
          output_tokens: number;
          request_count: number;
        },
        row: Record<string, unknown>,
      ) => ({
        total_cost_usd: acc.total_cost_usd + (row.total_cost_usd as number),
        input_tokens: acc.input_tokens + (row.input_tokens as number),
        output_tokens: acc.output_tokens + (row.output_tokens as number),
        request_count: acc.request_count + 1,
      }),
      { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, request_count: 0 },
    );

    return cachedJson({
      totals,
      daily: daily ?? [],
      by_agent: byAgentSummary,
      by_model: byModelSummary,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
