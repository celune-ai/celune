import { NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { deliverWebhook } from '@/lib/webhooks';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/retry
 * Cron-triggered: retries failed webhook deliveries whose next_retry_at has passed.
 * Protected by CRON_SECRET header check.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Find deliveries due for retry
  const { data: pendingRetries, error } = await supabase
    .from('webhook_deliveries')
    .select('id, endpoint_id, event_type, payload, attempt')
    .is('delivered_at', null)
    .not('next_retry_at', 'is', null)
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(50);

  if (error) {
    return safeErrorResponse(error);
  }

  if (!pendingRetries?.length) {
    return NextResponse.json({ retried: 0 });
  }

  let retried = 0;
  for (const delivery of pendingRetries) {
    // Clear next_retry_at to prevent duplicate processing
    await supabase.from('webhook_deliveries').update({ next_retry_at: null }).eq('id', delivery.id);

    // Look up the endpoint
    const { data: endpoint } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret, events, is_active')
      .eq('id', delivery.endpoint_id)
      .single();

    if (!endpoint?.is_active) continue;

    await deliverWebhook(
      supabase,
      endpoint,
      delivery.event_type,
      delivery.payload,
      delivery.attempt + 1,
    );
    retried++;
  }

  return NextResponse.json({ retried, checked: pendingRetries.length });
}
