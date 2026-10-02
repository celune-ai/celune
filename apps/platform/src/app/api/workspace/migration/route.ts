/**
 * GET /api/workspace/migration?workspace_id=<uuid>
 *
 * Describes the migration options for this instance: its edition, where a
 * move goes, and the feature diff read from the Gate of each edition.
 * Auth: session plus settings:manage, or an API key with read scope.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';
import { hostConfig } from '@/lib/host-config';
import { authorizeWorkspaceTransfer } from '@/lib/workspace-transfer/auth';
import { featureDiff } from '@/lib/workspace-transfer/migration';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rl = await applyRateLimit(request, 'workspace.migration', RATE_READ);
  if (rl) return rl.blocked;

  try {
    const actor = await authorizeWorkspaceTransfer(request, 'read');
    if (actor instanceof NextResponse) return actor;

    const edition = hostConfig.edition;
    const target = edition === 'cloud' ? 'community' : 'cloud';
    return NextResponse.json({
      edition,
      target_edition: target,
      product_name: hostConfig.productName,
      can_move_to_cloud: edition === 'community',
      cloud_url: edition === 'community' ? hostConfig.cloudUrl : null,
      docs_url: hostConfig.docsUrl,
      feature_diff: featureDiff(edition, target),
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
