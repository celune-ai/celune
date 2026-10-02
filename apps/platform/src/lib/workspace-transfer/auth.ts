import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ApiKeyScope } from '@repo/types';
import { authorizeBrainTransfer, type BrainTransferActor } from '@/lib/brain-transfer-auth';

/**
 * Same auth as brain transfer. Every caller needs settings:manage, since the
 * export holds every task and the import can replace them.
 */
export async function authorizeWorkspaceTransfer(
  request: NextRequest,
  scope: ApiKeyScope,
): Promise<BrainTransferActor | NextResponse> {
  return authorizeBrainTransfer(request, scope, ['settings:manage']);
}
