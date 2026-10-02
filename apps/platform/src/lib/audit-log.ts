import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';

interface AuditLogEntry {
  event_type: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  source?: string;
  title: string;
  details?: Record<string, unknown>;
  actor_user_id?: string | null;
  agent_id?: string | null;
  workspace_id?: string | null;
  resource_type?: string;
  resource_id?: string;
  before_state?: Record<string, unknown>;
  after_state?: Record<string, unknown>;
  ip_address?: string;
}

/**
 * Extract client IP from request headers.
 */
function getClientIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  );
}

/**
 * Log an audit event. Fire-and-forget — never blocks the request.
 */
export function auditLog(entry: AuditLogEntry, request?: NextRequest): void {
  void auditLogAsync(entry, request);
}

async function auditLogAsync(entry: AuditLogEntry, request?: NextRequest): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('activity_log').insert({
      event_type: entry.event_type,
      severity: entry.severity ?? 'info',
      source: entry.source ?? 'admin',
      title: entry.title,
      details: entry.details ?? {},
      actor_user_id: entry.actor_user_id ?? null,
      agent_id: entry.agent_id ?? null,
      workspace_id: entry.workspace_id ?? null,
      resource_type: entry.resource_type ?? null,
      resource_id: entry.resource_id ?? null,
      before_state: entry.before_state ?? null,
      after_state: entry.after_state ?? null,
      ip_address: request ? getClientIp(request) : null,
    });
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[auditLog] Failed to log:', entry.event_type);
    }
  }
}
