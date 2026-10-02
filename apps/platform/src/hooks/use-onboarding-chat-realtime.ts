'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@repo/db/client';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  metadata?: { source_channel?: string } | null;
}

interface Handlers {
  onNewMessage: (msg: ConversationMessage) => void;
  conversationId: string | null;
}

/**
 * Subscribes to live onboarding conversation messages via Supabase Realtime.
 * When a message is inserted from a different channel (e.g. MCP while web is open),
 * the handler fires and the UI can render it.
 */
export function useOnboardingChatRealtime({ onNewMessage, conversationId }: Handlers) {
  const handlerRef = useRef(onNewMessage);
  handlerRef.current = onNewMessage;

  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`onboarding-chat-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!payload.new) return;
          const row = payload.new as {
            role: string;
            content: string;
            metadata: { source_channel?: string } | null;
          };
          handlerRef.current({
            role: row.role as 'user' | 'assistant',
            content: row.content,
            metadata: row.metadata,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);
}
