import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { costIngestSchema } from '@/lib/schemas/analytics.schema';
import { trackUsage } from '@/lib/track-usage';
import { RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

type CostIngestBody = z.infer<typeof costIngestSchema>;

export const POST = withApiSecurity<CostIngestBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<CostIngestBody>) => {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('claude_usage')
      .insert({
        session_id: body.session_id,
        agent_name: body.agent_name ?? null,
        task_id: body.task_id ?? null,
        model: body.model,
        input_tokens: body.input_tokens,
        output_tokens: body.output_tokens,
        cache_read_tokens: body.cache_read_tokens ?? 0,
        cache_creation_tokens: body.cache_creation_tokens ?? 0,
        total_cost_usd: body.total_cost_usd,
        duration_ms: body.duration_ms ?? null,
        user_id: userId,
        workspace_id: body.workspace_id ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    // Also log to unified usage_events pipeline
    if (body.workspace_id) {
      trackUsage({
        workspace_id: body.workspace_id,
        user_id: userId,
        event_type: 'llm_tokens',
        quantity: body.input_tokens + body.output_tokens,
        unit: 'tokens',
        metadata: {
          model: body.model,
          agent_name: body.agent_name,
          cost_usd: body.total_cost_usd,
          input_tokens: body.input_tokens,
          output_tokens: body.output_tokens,
        },
      });
    }

    return NextResponse.json(data, { status: 201 });
  },
  {
    permission: 'analytics:read',
    rateLimit: { tier: RATE_WRITE, routeKey: 'analytics.cost.ingest.post' },
    parseBody: costIngestSchema,
  },
);
