import { z } from 'zod';
import type { McpToolHandler } from '../../types';
import { textResult } from '../../types';
import {
  workspaceOverrideSchema,
  resolveWorkspace,
  isResolveError,
} from '../../workspace-resolver';

export const getOnboardingConversation: McpToolHandler = {
  name: 'get_onboarding_conversation',
  description:
    'Get the full onboarding conversation history. Shows all messages regardless of whether they were sent from the web UI or this IDE. Call this after whoami indicates onboarding is in progress, so you know the context before responding.',
  schema: z.object({
    ...workspaceOverrideSchema,
  }),
  scope: 'read',
  group: 'onboarding',
  async execute(params, { auth, supabase }) {
    const resolved = await resolveWorkspace(params, auth, supabase);
    if (isResolveError(resolved)) return resolved;

    const { data: conversation } = await supabase
      .from('conversation_logs')
      .select('id, status, message_count')
      .eq('workspace_id', resolved.workspaceId)
      .eq('user_id', auth.userId)
      .eq('source', 'onboarding')
      .eq('status', 'active')
      .maybeSingle();

    if (!conversation) {
      return textResult(
        'No active onboarding conversation found. Start one from the Celune dashboard or use send_onboarding_message to begin.',
      );
    }

    const { data: messages } = await supabase
      .from('conversation_messages')
      .select('role, content, metadata, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });

    const formatted = (messages ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => {
        const channel =
          (m.metadata as { source_channel?: string } | null)?.source_channel ?? 'unknown';
        const role = m.role === 'user' ? 'You' : 'Agent';
        const content =
          m.role === 'assistant' ? m.content.replace(/\[MEMORY:[^\]]+\]/g, '').trim() : m.content;
        return `[${role} via ${channel}]: ${content}`;
      })
      .join('\n\n');

    return textResult(
      `Onboarding conversation (${conversation.message_count} messages):\n\n${formatted}`,
    );
  },
};
