/**
 * SOC 2 Security Audit Logger
 *
 * Dual-writes to:
 * 1. activity_log (existing, for UI display)
 * 2. security_audit_log (immutable, for SOC 2 compliance — no UPDATE/DELETE)
 *
 * Fire-and-forget: audit logging failures never block the request.
 */

import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';

// Must match the security_event_type enum in 20260324_security_audit_log.sql
export type SecurityEventType =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.token_refresh'
  | 'auth.password_change'
  | 'auth.mfa_enable'
  | 'auth.mfa_disable'
  | 'admin.role_change'
  | 'admin.permission_change'
  | 'admin.user_invite'
  | 'admin.user_remove'
  | 'admin.workspace_create'
  | 'admin.workspace_delete'
  | 'apikey.create'
  | 'apikey.rotate'
  | 'apikey.delete'
  | 'apikey.validate'
  | 'provider_key.create'
  | 'provider_key.rotate'
  | 'provider_key.delete'
  | 'provider_key.decrypt'
  | 'data.export'
  | 'data.delete'
  | 'data.bulk_operation'
  | 'config.change'
  | 'security.rate_limit_exceeded'
  | 'security.csrf_violation'
  | 'security.unauthorized_access';

export type SecuritySeverity = 'info' | 'warning' | 'error' | 'critical';

export interface SecurityEvent {
  event_type: SecurityEventType;
  severity?: SecuritySeverity;
  actor_id?: string | null;
  actor_email?: string | null;
  target_type?: string;
  target_id?: string;
  workspace_id?: string | null;
  details?: Record<string, unknown>;
}

// Legacy type aliases for backward compatibility
export type SecurityAction =
  | 'auth.failure'
  | 'auth.success'
  | 'permission.denied'
  | 'data.export'
  | 'data.delete'
  | 'key.created'
  | 'key.rotated'
  | 'key.deleted'
  | 'key.resolved'
  | 'guardrail.triggered'
  | 'rate_limit.exceeded'
  | 'workspace.access_denied';

// Maps legacy actions to new event types
const LEGACY_ACTION_MAP: Record<SecurityAction, SecurityEventType> = {
  'auth.failure': 'auth.login_failed',
  'auth.success': 'auth.login',
  'permission.denied': 'security.unauthorized_access',
  'data.export': 'data.export',
  'data.delete': 'data.delete',
  'key.created': 'provider_key.create',
  'key.rotated': 'provider_key.rotate',
  'key.deleted': 'provider_key.delete',
  'key.resolved': 'provider_key.decrypt',
  'guardrail.triggered': 'security.unauthorized_access',
  'rate_limit.exceeded': 'security.rate_limit_exceeded',
  'workspace.access_denied': 'security.unauthorized_access',
};

function getClientIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  );
}

/**
 * Log a security event to both activity_log and security_audit_log.
 * Fire-and-forget — never throws, never blocks.
 */
export function logSecurityEvent(
  event:
    | SecurityEvent
    | {
        action: SecurityAction;
        actor?: string;
        resource?: string;
        result: string;
        workspaceId?: string;
        metadata?: Record<string, unknown>;
      },
  request?: NextRequest,
): void {
  void logSecurityEventAsync(event, request);
}

async function logSecurityEventAsync(
  event:
    | SecurityEvent
    | {
        action: SecurityAction;
        actor?: string;
        resource?: string;
        result: string;
        workspaceId?: string;
        metadata?: Record<string, unknown>;
      },
  request?: NextRequest,
): Promise<void> {
  try {
    const supabase = createServiceClient();

    // Normalize legacy events to new format
    let normalized: SecurityEvent;
    if ('action' in event) {
      normalized = {
        event_type:
          LEGACY_ACTION_MAP[event.action as SecurityAction] ?? 'security.unauthorized_access',
        severity: event.result === 'denied' || event.result === 'error' ? 'warning' : 'info',
        actor_id: event.actor ?? null,
        workspace_id: event.workspaceId ?? null,
        details: { resource: event.resource, result: event.result, ...event.metadata },
      };
    } else {
      normalized = event;
    }

    // Write to immutable security_audit_log (SOC 2)
    await supabase.from('security_audit_log').insert({
      event_type: normalized.event_type,
      severity: normalized.severity ?? 'info',
      actor_id: normalized.actor_id ?? null,
      actor_email: normalized.actor_email ?? null,
      target_type: normalized.target_type ?? null,
      target_id: normalized.target_id ?? null,
      workspace_id: normalized.workspace_id ?? null,
      ip_address: request ? getClientIp(request) : null,
      user_agent: request ? request.headers.get('user-agent') : null,
      details: normalized.details ?? {},
    });

    // Also write to activity_log (for UI display)
    const title = `[security] ${normalized.event_type}`;
    await supabase.from('activity_log').insert({
      event_type: normalized.event_type,
      severity: normalized.severity === 'critical' ? 'error' : (normalized.severity ?? 'info'),
      source: 'security-audit',
      title,
      details: normalized.details ?? {},
      actor_user_id: normalized.actor_id ?? null,
      workspace_id: normalized.workspace_id ?? null,
      resource_type: normalized.target_type ?? null,
      resource_id: normalized.target_id ?? null,
      ip_address: request ? getClientIp(request) : null,
    });
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[security-audit] Failed to log:',
        'event_type' in event ? event.event_type : (event as { action: string }).action,
      );
    }
  }
}

/**
 * Log an authentication failure.
 */
export function logAuthFailure(
  reason: string,
  metadata?: Record<string, unknown>,
  request?: NextRequest,
): void {
  logSecurityEvent(
    {
      event_type: 'auth.login_failed',
      severity: 'warning',
      details: { reason, ...metadata },
    },
    request,
  );
}

/**
 * Log a successful authentication.
 */
export function logAuthSuccess(userId: string, email?: string, request?: NextRequest): void {
  logSecurityEvent(
    {
      event_type: 'auth.login',
      severity: 'info',
      actor_id: userId,
      actor_email: email ?? null,
    },
    request,
  );
}

/**
 * Log a permission denial.
 */
export function logPermissionDenied(
  userId: string,
  permission: string,
  workspaceId?: string,
  request?: NextRequest,
): void {
  logSecurityEvent(
    {
      event_type: 'security.unauthorized_access',
      severity: 'warning',
      actor_id: userId,
      target_type: 'permission',
      target_id: permission,
      workspace_id: workspaceId,
      details: { permission },
    },
    request,
  );
}

/**
 * Log a guardrail trigger event.
 */
export function logGuardrailTriggered(
  userId: string,
  railType: 'input' | 'output' | 'pii',
  patterns: string[],
  severity: string,
  workspaceId?: string,
  request?: NextRequest,
): void {
  logSecurityEvent(
    {
      event_type: 'security.unauthorized_access',
      severity: severity === 'high' ? 'error' : 'warning',
      actor_id: userId,
      target_type: 'guardrail',
      target_id: railType,
      workspace_id: workspaceId,
      details: { rail_type: railType, patterns, severity },
    },
    request,
  );
}

/**
 * Log a provider key operation.
 */
export function logKeyEvent(
  action: 'key.created' | 'key.rotated' | 'key.deleted' | 'key.resolved',
  userId: string,
  provider: string,
  workspaceId?: string,
  metadata?: Record<string, unknown>,
  request?: NextRequest,
): void {
  const eventType = LEGACY_ACTION_MAP[action] ?? 'provider_key.create';
  logSecurityEvent(
    {
      event_type: eventType,
      severity: 'info',
      actor_id: userId,
      target_type: 'provider_key',
      target_id: provider,
      workspace_id: workspaceId,
      details: metadata,
    },
    request,
  );
}

/**
 * Log an admin action (role change, invite, etc.).
 */
export function logAdminEvent(
  eventType: SecurityEventType,
  actorId: string,
  target: { type: string; id: string },
  workspaceId?: string,
  details?: Record<string, unknown>,
  request?: NextRequest,
): void {
  logSecurityEvent(
    {
      event_type: eventType,
      severity: 'info',
      actor_id: actorId,
      target_type: target.type,
      target_id: target.id,
      workspace_id: workspaceId,
      details,
    },
    request,
  );
}
