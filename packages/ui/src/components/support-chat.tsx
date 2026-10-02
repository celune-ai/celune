'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface SupportChatProps {
  /** API endpoint for chat (e.g. "/api/chat/support" or full URL for cross-origin) */
  apiUrl: string;
  /** Context scope: web (marketing), docs, or app */
  context: 'web' | 'docs' | 'app';
  /** Brand accent color (CSS value) */
  accentColor?: string;
  /** Initial greeting message from assistant */
  greeting?: string;
  /** Position of the chat bubble */
  position?: 'bottom-right' | 'bottom-left';
  /** Whether the widget starts open */
  defaultOpen?: boolean;
  /** Custom title for the header */
  title?: string;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Called when assistant includes [NAV:/path] markers */
  onNavigate?: (path: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const NAV_PATTERN = /\[NAV:(\/[^\]]+)\]/g;

function stripNavMarkers(text: string): { clean: string; paths: string[] } {
  const paths: string[] = [];
  const clean = text.replace(NAV_PATTERN, (_, path) => {
    paths.push(path);
    return '';
  });
  return { clean: clean.trim(), paths };
}

// ── Component ──────────────────────────────────────────────────────────────

export function SupportChat({
  apiUrl,
  context,
  accentColor = '#5BC586',
  greeting = "Hi! I'm RICK. How can I help you today?",
  position = 'bottom-right',
  defaultOpen = false,
  title = 'Ask RICK',
  placeholder = 'Type a message...',
  onNavigate,
}: SupportChatProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: greeting }]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    // Add empty assistant message for streaming
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      abortRef.current = new AbortController();
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          context,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: "Sorry, I'm having trouble right now. Please try again.",
          };
          return copy;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const display = accumulated;
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: display };
          return copy;
        });
      }

      // Process navigation markers
      const { clean, paths } = stripNavMarkers(accumulated);
      if (paths.length > 0) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: clean };
          return copy;
        });
        if (onNavigate) {
          paths.forEach((p) => onNavigate(p));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
          };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming, apiUrl, context, onNavigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const posClass = position === 'bottom-left' ? 'left-4' : 'right-4';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-4 ${posClass} z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105`}
        style={{ backgroundColor: accentColor }}
        aria-label="Open support chat"
      >
        <MessageCircle className="h-6 w-6 text-black" />
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-4 ${posClass} z-50 flex h-[500px] w-[380px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1a1a1a] shadow-2xl`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: accentColor }}
      >
        <span className="text-sm font-semibold text-black">{title}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-black/70 transition-colors hover:text-black"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'rounded-br-sm text-black'
                  : 'rounded-bl-sm bg-white/8 text-white/90'
              }`}
              style={msg.role === 'user' ? { backgroundColor: accentColor } : undefined}
            >
              <p className="break-words whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {streaming && messages[messages.length - 1]?.content === '' && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white/8 px-3.5 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-white/50" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-white/10 px-3 py-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 resize-none rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 outline-none focus:ring-1"
            style={{ '--tw-ring-color': accentColor } as React.CSSProperties}
            disabled={streaming}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
            style={{ backgroundColor: input.trim() && !streaming ? accentColor : undefined }}
            aria-label="Send message"
          >
            <Send className="h-4 w-4 text-black" />
          </button>
        </div>
      </div>
    </div>
  );
}
