import type { GateResult } from '@celuneai/core';

export type WorkspaceMetadataReader = (
  workspaceId: string,
) => Promise<Record<string, unknown> | null>;

/** Reads `metadata.suspended_at`; fails closed with a 503 when the read throws. */
export async function checkSuspension(
  read: WorkspaceMetadataReader,
  workspaceId: string,
): Promise<GateResult> {
  let metadata: Record<string, unknown> | null;
  try {
    metadata = await read(workspaceId);
  } catch (error) {
    console.error('[ee-gates] suspension check failed, blocking request:', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: false,
      reason: 'suspension_unverified',
      status: 503,
      details: { error: 'Unable to verify workspace status. Please try again.' },
    };
  }
  const suspendedAt = metadata?.suspended_at;
  if (!suspendedAt) return { allowed: true };
  return {
    allowed: false,
    reason: 'workspace_suspended',
    status: 403,
    details: {
      error: 'workspace_suspended',
      message: 'This workspace has been suspended. Contact support for assistance.',
      suspended_at: suspendedAt,
    },
  };
}
