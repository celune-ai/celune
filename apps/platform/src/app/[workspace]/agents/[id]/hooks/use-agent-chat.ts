'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message } from '../components/chat-message';
import type { ParameterValues } from '@/lib/agents-data';

/** Strip [NAV:/path] markers from text and return the first path found */
function extractNavCommand(text: string): { cleanText: string; navPath: string | null } {
  const navRegex = /\s*\[NAV:(\/[a-z0-9/_-]+)\]\s*/gi;
  let navPath: string | null = null;
  const cleanText = text
    .replace(navRegex, (_match, path: string) => {
      if (!navPath) navPath = path; // take first match only
      return ' ';
    })
    .trim();
  return { cleanText, navPath };
}

interface UseAgentChatOptions {
  agentId: string;
  workspaceId?: string;
  values: ParameterValues;
  voiceMode?: boolean;
  onAssistantComplete?: (text: string) => void;
  onStreamingSentence?: (sentence: string) => void;
  onNavigate?: (path: string) => void;
}

interface UseAgentChatReturn {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  chatError: string | null;
  sendMessage: (overrideText?: string) => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  clearChat: () => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useAgentChat({
  agentId,
  workspaceId,
  values,
  voiceMode,
  onAssistantComplete,
  onStreamingSentence,
  onNavigate,
}: UseAgentChatOptions): UseAgentChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const onAssistantCompleteRef = useRef(onAssistantComplete);
  onAssistantCompleteRef.current = onAssistantComplete;
  const onStreamingSentenceRef = useRef(onStreamingSentence);
  onStreamingSentenceRef.current = onStreamingSentence;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  // Auto-scroll chat to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || streaming) return;

      // Track the owner's last activity for team page status
      localStorage.setItem('eric_last_message_at', Date.now().toString());

      setChatError(null);
      const userMessage: Message = { role: 'user', content: text };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      if (!overrideText) setInput('');
      setStreaming(true);

      // Add empty assistant message to stream into
      setMessages([...nextMessages, { role: 'assistant', content: '' }]);

      try {
        const response = await fetch(`/api/agents/${agentId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: nextMessages,
            parameters: values,
            voice_mode: voiceModeRef.current || undefined,
            workspace_id: workspaceId,
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          // Include BYOK hint in error message when plan limit is hit
          const msg = err.error ?? `HTTP ${response.status}`;
          const byokSuffix = err.byok_hint ? ` ${err.byok_hint}` : '';
          throw new Error(msg + byokSuffix);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let emittedLength = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setMessages([...nextMessages, { role: 'assistant', content: accumulated }]);

          // Detect sentence boundaries during streaming for immediate TTS
          if (voiceModeRef.current && onStreamingSentenceRef.current) {
            const unemitted = accumulated.slice(emittedLength);
            // Only match sentence-end when followed by whitespace (not $).
            // Matching $ caused double-emit at chunk boundaries, killing TTS mid-playback.
            const sentenceEndRegex = /[.!?]["')»]?\s/g;
            let match;
            while ((match = sentenceEndRegex.exec(unemitted)) !== null) {
              const endIdx = emittedLength + match.index + 1;
              const sentence = accumulated.slice(emittedLength, endIdx).trim();
              if (sentence) {
                onStreamingSentenceRef.current(sentence);
                emittedLength = endIdx;
              }
            }
          }
        }

        // Emit any remaining text that didn't end with sentence punctuation
        if (voiceModeRef.current && onStreamingSentenceRef.current) {
          const remainder = accumulated.slice(emittedLength).trim();
          if (remainder) {
            onStreamingSentenceRef.current(remainder);
          }
        }

        // Extract navigation commands and clean the displayed text
        const { cleanText, navPath } = extractNavCommand(accumulated);
        if (cleanText !== accumulated) {
          setMessages([...nextMessages, { role: 'assistant', content: cleanText }]);
        }

        // Trigger navigation after a short delay so the user sees the response
        if (navPath && onNavigateRef.current) {
          setTimeout(() => onNavigateRef.current?.(navPath), 800);
        }

        // Notify when assistant response is complete
        if (accumulated && onAssistantCompleteRef.current) {
          onAssistantCompleteRef.current(cleanText || accumulated);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Request failed';
        setChatError(msg);
        // Remove the empty assistant placeholder on error
        setMessages(nextMessages);
      } finally {
        setStreaming(false);
      }
    },
    [agentId, input, messages, streaming, values],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setChatError(null);
  }, []);

  return {
    messages,
    input,
    setInput,
    streaming,
    chatError,
    sendMessage,
    handleKeyDown,
    clearChat,
    bottomRef,
    textareaRef,
  };
}
