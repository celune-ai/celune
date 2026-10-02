import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { isValidUuid } from '@repo/db/validation';
import { requirePermission } from '@/lib/permissions';
import { applyRateLimit, RATE_READ } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/support/triage/[id]/messages?workspace_id=...
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
  }
  const workspaceId = request.nextUrl.searchParams.get('workspace_id');

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  const permResult = await requirePermission(request, workspaceId, 'settings:manage');
  if (permResult instanceof NextResponse) return permResult;

  const rateLimitResult = await applyRateLimit(request, 'support.triage.messages.read', RATE_READ);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const supabase = createServiceClient();

    // Verify conversation belongs to the requesting workspace
    const { data: conv, error: convError } = await supabase
      .from('conversation_logs')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, conversation_id, role, content, metadata, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
