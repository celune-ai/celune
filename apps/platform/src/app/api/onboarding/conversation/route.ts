import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth';
import { createServiceClient } from '@repo/db/service';
import { requireWorkspaceMembership } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding/conversation?workspace_id=<uuid>
 *
 * Returns the active onboarding conversation and its messages.
 * Used by the web chat to hydrate from DB on mount (so IDE-sent messages appear).
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }

    const membershipResult = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipResult instanceof NextResponse) return membershipResult;

    const supabase = createServiceClient();

    // Find the active onboarding conversation
    const { data: conversation } = await supabase
      .from('conversation_logs')
      .select('id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('source', 'onboarding')
      .eq('status', 'active')
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ conversation_id: null, messages: [] });
    }

    // Load all messages
    const { data: messages } = await supabase
      .from('conversation_messages')
      .select('role, content, metadata, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    return NextResponse.json({
      conversation_id: conversation.id,
      messages: (messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
        source_channel: (m.metadata as { source_channel?: string } | null)?.source_channel ?? 'web',
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
