import type { getTask } from '@repo/db/queries';

type SupabaseClient = Parameters<typeof getTask>[0];

/** Token and cost totals from claude_usage for one task. Callers check the task's workspace first. */
export async function getTaskUsage(
  supabase: SupabaseClient,
  taskId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('claude_usage')
    .select(
      'input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, total_cost_usd, model, duration_ms',
    )
    .eq('task_id', taskId);
  if (error) throw error;
  if (!data || data.length === 0) return { hasUsage: false };

  const totals = data.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + (row.input_tokens ?? 0),
      outputTokens: acc.outputTokens + (row.output_tokens ?? 0),
      cacheReadTokens: acc.cacheReadTokens + (row.cache_read_tokens ?? 0),
      cacheCreationTokens: acc.cacheCreationTokens + (row.cache_creation_tokens ?? 0),
      totalCost: acc.totalCost + Number(row.total_cost_usd ?? 0),
      totalDurationMs: acc.totalDurationMs + (row.duration_ms ?? 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCost: 0,
      totalDurationMs: 0,
    },
  );
  const models = [...new Set(data.map((r) => r.model).filter(Boolean))];
  return {
    hasUsage: true,
    requests: data.length,
    models,
    ...totals,
    totalTokens: totals.inputTokens + totals.outputTokens,
  };
}
