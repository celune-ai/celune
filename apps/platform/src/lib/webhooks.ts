import { createHmac, randomBytes } from 'crypto';
import { createServiceClient } from '@repo/db/service';
import { isBlockedUrl } from '@/lib/knowledge/connectors/url-crawl';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 60_000, 300_000]; // immediate, 1min, 5min
const DELIVERY_TIMEOUT = 10_000; // 10s

export type WebhookEventType =
  | 'task.created'
  | 'task.completed'
  | 'task.updated'
  | 'agent.status_changed'
  | 'usage.threshold_reached'
  | 'billing.invoice_paid';

export const ALL_WEBHOOK_EVENTS: WebhookEventType[] = [
  'task.created',
  'task.completed',
  'task.updated',
  'agent.status_changed',
  'usage.threshold_reached',
  'billing.invoice_paid',
];

/**
 * Generate a webhook signing secret.
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * Sign a webhook payload with HMAC-SHA256.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

interface WebhookEndpointRow {
  id: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
}

/**
 * Dispatch a webhook event to all matching endpoints for a workspace.
 * Fire-and-forget — errors are logged but never block the caller.
 */
export function dispatchWebhook(
  workspaceId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): void {
  void dispatchWebhookAsync(workspaceId, eventType, payload);
}

async function dispatchWebhookAsync(
  workspaceId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    // Service client: webhook dispatch is fire-and-forget with no user session context. Accesses: webhook_endpoints, webhook_deliveries.
    const supabase = createServiceClient();

    // Find active endpoints subscribed to this event
    const { data: endpoints } = await supabase
      .from('webhook_endpoints')
      .select('id, url, secret, events, is_active')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (!endpoints || endpoints.length === 0) return;

    const matching = (endpoints as WebhookEndpointRow[]).filter(
      (ep) => ep.events.includes(eventType) || ep.events.includes('*'),
    );

    for (const endpoint of matching) {
      void deliverWebhook(supabase, endpoint, eventType, payload);
    }
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[webhooks] Failed to dispatch:', eventType);
    }
  }
}

export async function deliverWebhook(
  supabase: ReturnType<typeof createServiceClient>,
  endpoint: WebhookEndpointRow,
  eventType: string,
  payload: Record<string, unknown>,
  attempt = 1,
): Promise<void> {
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    type: eventType,
    created_at: new Date().toISOString(),
    data: payload,
  });

  const signature = signPayload(body, endpoint.secret);

  try {
    // SSRF guard: block internal/private network URLs
    if (isBlockedUrl(endpoint.url)) {
      await supabase.from('webhook_deliveries').insert({
        endpoint_id: endpoint.id,
        event_type: eventType,
        payload,
        response_status: 0,
        attempt,
        failed_at: new Date().toISOString(),
        next_retry_at: null,
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT);

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': eventType,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Log delivery
    await supabase.from('webhook_deliveries').insert({
      endpoint_id: endpoint.id,
      event_type: eventType,
      payload,
      response_status: response.status,
      attempt,
      delivered_at: response.ok ? new Date().toISOString() : null,
      failed_at: response.ok ? null : new Date().toISOString(),
      next_retry_at:
        !response.ok && attempt < MAX_RETRIES
          ? new Date(Date.now() + RETRY_DELAYS[attempt]).toISOString()
          : null,
    });

    // Retries are handled by the cron-based retry consumer
    // (polls webhook_deliveries WHERE next_retry_at < NOW())
  } catch (err) {
    // Network error / timeout
    await supabase.from('webhook_deliveries').insert({
      endpoint_id: endpoint.id,
      event_type: eventType,
      payload,
      response_status: null,
      response_body: err instanceof Error ? err.message : 'Unknown error',
      attempt,
      failed_at: new Date().toISOString(),
      next_retry_at:
        attempt < MAX_RETRIES ? new Date(Date.now() + RETRY_DELAYS[attempt]).toISOString() : null,
    });
  }
}
