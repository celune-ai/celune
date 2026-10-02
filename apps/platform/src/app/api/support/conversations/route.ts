import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth';
import { createServiceClient } from '@repo/db/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/support/conversations?workspace_id=<uuid>
 *
 * Default: Returns the most recent active support conversation for this user/workspace.
 * If the conversation is older than 24 hours, it is auto-archived and a fresh start is returned.
 *
 * ?all=true: Returns all conversations (active + archived) with preview text for history view.
 * ?conversation_id=<uuid>: Returns a specific conversation and its messages.
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

    const supabase = createServiceClient();
    const allMode = request.nextUrl.searchParams.get('all') === 'true';
    const specificConvId = request.nextUrl.searchParams.get('conversation_id');

    // Load a specific conversation by ID — verify the user owns it first
    if (specificConvId) {
      const { data: conversation } = await supabase
        .from('conversation_logs')
        .select('id')
        .eq('id', specificConvId)
        .eq('user_id', userId)
        .single();

      if (!conversation) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }

      const { data: messages } = await supabase
        .from('conversation_messages')
        .select('role, content, created_at')
        .eq('conversation_id', specificConvId)
        .order('created_at', { ascending: true });

      return NextResponse.json({
        conversation: { id: specificConvId },
        messages: (messages ?? []).map((m) => ({ role: m.role, content: m.content })),
      });
    }

    // Return all conversations for history view
    if (allMode) {
      const { data: conversations } = await supabase
        .from('conversation_logs')
        .select('id, updated_at, status')
        .eq('user_id', userId)
        .eq('workspace_id', workspaceId)
        .eq('source', 'web_chat')
        .order('updated_at', { ascending: false })
        .limit(50);

      if (!conversations || conversations.length === 0) {
        return NextResponse.json({ conversations: [] });
      }

      // Fetch the first user message from each conversation as preview
      const convIds = conversations.map((c) => c.id);
      const { data: previews } = await supabase
        .from('conversation_messages')
        .select('conversation_id, content')
        .in('conversation_id', convIds)
        .eq('role', 'user')
        .order('created_at', { ascending: true });

      // Build a map of conversation_id -> first user message
      const previewMap = new Map<string, string>();
      for (const p of previews ?? []) {
        if (!previewMap.has(p.conversation_id)) {
          previewMap.set(
            p.conversation_id,
            p.content.length > 80 ? p.content.slice(0, 80) + '...' : p.content,
          );
        }
      }

      return NextResponse.json({
        conversations: conversations.map((c) => ({
          id: c.id,
          updated_at: c.updated_at,
          preview: previewMap.get(c.id) ?? 'Conversation',
        })),
      });
    }

    // Default: most recent active conversation
    const { data: conversation } = await supabase
      .from('conversation_logs')
      .select('id, updated_at, status')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('source', 'web_chat')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      return NextResponse.json({ conversation: null, messages: [] });
    }

    // Auto-archive if older than 24 hours
    const lastUpdate = new Date(conversation.updated_at).getTime();
    const hoursAgo = (Date.now() - lastUpdate) / (1000 * 60 * 60);

    if (hoursAgo > 24) {
      await supabase
        .from('conversation_logs')
        .update({ status: 'archived', ended_at: new Date().toISOString() })
        .eq('id', conversation.id);
      return NextResponse.json({ conversation: null, messages: [] });
    }

    // Load messages for this conversation
    const { data: messages } = await supabase
      .from('conversation_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    return NextResponse.json({
      conversation: { id: conversation.id },
      messages: (messages ?? []).map((m) => ({ role: m.role, content: m.content })),
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
