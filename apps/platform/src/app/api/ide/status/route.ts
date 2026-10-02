/**
 * GET /api/ide/status — Check if workspace has an active IDE connection.
 *
 * Returns { connected: boolean, last_seen: string | null, ide_count: number }
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getAuthUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
  }

  const userId = getAuthUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Verify workspace membership
  const { count: memberCount } = await supabase
    .from('workspace_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (!memberCount || memberCount === 0) {
    return NextResponse.json({ error: 'Forbidden — not a workspace member' }, { status: 403 });
  }

  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  // Count active IDE connections (API keys used within last 5 min)
  const { data: keys, count } = await supabase
    .from('api_keys')
    .select('name, last_used_at', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .gte('last_used_at', twoMinutesAgo)
    .order('last_used_at', { ascending: false })
    .limit(1);

  const lastSeen = keys?.[0]?.last_used_at ?? null;

  return NextResponse.json({
    connected: (count ?? 0) > 0,
    last_seen: lastSeen,
    ide_count: count ?? 0,
  });
}
