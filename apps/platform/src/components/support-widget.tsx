'use client';

import Image from 'next/image';
import { useState, useRef, useEffect, useCallback, type ReactNode, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  MessageSquare,
  X,
  Send,
  LifeBuoy,
  Loader2,
  Menu,
  Plus,
  Clock,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useSupportChat } from '@/providers/support-chat-provider';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface LeadAgentInfo {
  name: string;
  color: string;
  initials: string;
  icon: string | null;
}

interface ConversationSummary {
  id: string;
  updated_at: string;
  preview: string;
}

type View = 'chat' | 'menu' | 'history';

/** Render markdown in chat bubbles. Raw markdown stays in message data for memory/logging. */
const Markdown = dynamic(() => import('react-markdown'), { ssr: false });

function FormattedMessage({ text }: { text: string }) {
  return (
    <Markdown
      components={{
        p: ({ children }) => <p className="my-1">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        code: ({ children }) => (
          <code className="bg-surface-300 rounded px-1 py-0.5 text-xs">{children}</code>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2"
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </Markdown>
  );
}

function SupportChat({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('chat');
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [leadAgent, setLeadAgent] = useState<LeadAgentInfo>({
    name: 'Support',
    color: '',
    initials: 'S',
    icon: null,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const promptConsumedRef = useRef(false);
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const { pendingHelp, consumeHelp } = useSupportChat();
  const pathname = usePathname();

  // Load conversation history from server on mount
  useEffect(() => {
    if (!activeWorkspace?.id) {
      setLoading(false);
      return;
    }
    fetch(apiUrl(`/api/support/conversations?workspace_id=${activeWorkspace.id}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.conversation?.id) {
          setConversationId(data.conversation.id);
          setMessages(data.messages ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeWorkspace?.id]);

  // Load the user's main agent
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const SEEDED_IDS = new Set([
      'lead',
      'reviewer',
      'pm',
      'designer',
      'researcher',
      'brand',
      'analyst',
    ]);
    fetch(apiUrl(`/api/agents/configs?workspace_id=${activeWorkspace.id}`))
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          configs: Array<{
            agent_id: string;
            display_name: string | null;
            color: string | null;
            role: string | null;
            agent_type: string | null;
            icon: string | null;
          }>,
        ) => {
          // Prefer custom agent (created during onboarding), fall back to seeded lead
          const mainAgent =
            configs.find((c) => c.agent_type === 'ai' && !SEEDED_IDS.has(c.agent_id)) ??
            configs.find((c) => c.agent_id === 'lead' || c.role === 'Lead Agent') ??
            configs.find((c) => c.agent_type === 'ai');
          if (mainAgent) {
            const name = mainAgent.display_name ?? 'Lead';
            setLeadAgent({
              name,
              color: mainAgent.color ?? '',
              initials: name.slice(0, 2).toUpperCase(),
              icon: mainAgent.icon ?? null,
            });
          }
        },
      )
      .catch(() => {});
  }, [activeWorkspace?.id]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  // Reset textarea height when input is cleared (e.g. after sending)
  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [input]);

  // Focus input on mount
  useEffect(() => {
    if (!loading && view === 'chat') inputRef.current?.focus();
  }, [loading, view]);

  // Abort streaming on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string, currentMessages: ChatMessage[]) => {
      if (!text || streaming || !activeWorkspace?.id) return;

      const userMessage: ChatMessage = { role: 'user', content: text };
      const newMessages = [...currentMessages, userMessage];
      setMessages(newMessages);
      setInput('');
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(apiUrl('/api/support/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
            workspace_id: activeWorkspace.id,
            ...(conversationId ? { conversation_id: conversationId } : {}),
            page_path: pathname,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Something went wrong' }));
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: err.error || 'Something went wrong. Please try again.' },
          ]);
          return;
        }

        const respConvId = res.headers.get('X-Conversation-Id');
        if (respConvId && !conversationId) {
          setConversationId(respConvId);
        }

        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let assistantText = '';

        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantText += decoder.decode(value, { stream: true });
          const snapshot = assistantText;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: snapshot };
            return updated;
          });
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Connection error. Please try again.' },
        ]);
      } finally {
        setStreaming(false);
      }
    },
    [streaming, activeWorkspace?.id, conversationId],
  );

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text) return;
      sendMessage(text, messages);
    },
    [input, messages, sendMessage],
  );

  // Auto-send pending help from HelpButton
  useEffect(() => {
    if (pendingHelp && !loading && !promptConsumedRef.current) {
      promptConsumedRef.current = true;
      setMessages([]);
      setConversationId(null);
      setView('chat');

      if (pendingHelp.staticResponse) {
        setTimeout(() => {
          setMessages([
            { role: 'user', content: pendingHelp.prompt },
            { role: 'assistant', content: pendingHelp.staticResponse! },
          ]);
          consumeHelp();
        }, 50);
      } else {
        setTimeout(() => {
          sendMessage(pendingHelp.prompt, []);
          consumeHelp();
        }, 50);
      }
    }
  }, [pendingHelp, loading, sendMessage, consumeHelp]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  function handleNewConversation() {
    if (conversationId && activeWorkspace?.id) {
      fetch(apiUrl('/api/support/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: '__archive__' }],
          workspace_id: activeWorkspace.id,
          conversation_id: conversationId,
        }),
      }).catch(() => {});
    }
    setMessages([]);
    setConversationId(null);
    setView('chat');
  }

  async function loadHistory() {
    if (!activeWorkspace?.id) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/api/support/conversations?workspace_id=${activeWorkspace.id}&all=true`),
      );
      if (res.ok) {
        const data = await res.json();
        setHistory(data.conversations ?? []);
      }
    } catch {
      // Non-fatal
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadConversation(convId: string) {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    setView('chat');
    try {
      const res = await fetch(
        apiUrl(
          `/api/support/conversations?workspace_id=${activeWorkspace.id}&conversation_id=${convId}`,
        ),
      );
      if (res.ok) {
        const data = await res.json();
        setConversationId(data.conversation?.id ?? convId);
        setMessages(data.messages ?? []);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }

  function formatTimestamp(ts: string) {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffHrs < 1) return 'Just now';
    if (diffHrs < 24) return `${Math.floor(diffHrs)}h ago`;
    if (diffHrs < 48) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Agent avatar element
  const agentAvatar = leadAgent.icon ? (
    <Image
      src={leadAgent.icon}
      alt={leadAgent.name}
      className="h-6 w-6 rounded-full object-cover"
      width={24}
      height={24}
      unoptimized
    />
  ) : (
    <div
      className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{
        backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(leadAgent.color ?? '')
          ? leadAgent.color
          : 'var(--brand-default)',
      }}
    >
      {leadAgent.initials}
    </div>
  );

  return (
    <div className="border-border bg-surface-100 flex h-[min(480px,100dvh)] w-full flex-col overflow-hidden border shadow-xl max-sm:rounded-none sm:h-[min(480px,calc(100dvh-6rem))] sm:w-[360px] sm:rounded-xl">
      {/* Header */}
      <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          {agentAvatar}
          <span className="text-foreground text-sm font-semibold">{leadAgent.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewConversation}
            className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors hover:bg-white/5"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (view === 'chat') {
                setView('menu');
              } else {
                setView('chat');
              }
            }}
            className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors hover:bg-white/5"
            aria-label="Menu"
          >
            {view !== 'chat' ? <ArrowLeft className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <button
            onClick={onClose}
            className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors hover:bg-white/5"
            aria-label="Close support chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Menu view */}
      {view === 'menu' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <button
              onClick={handleNewConversation}
              className="text-foreground hover:bg-surface-200 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
            >
              <Plus className="h-4 w-4 opacity-50" />
              New chat
            </button>
            <button
              onClick={() => {
                setView('history');
                loadHistory();
              }}
              className="text-foreground hover:bg-surface-200 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
            >
              <Clock className="h-4 w-4 opacity-50" />
              Chat history
            </button>
            <a
              href={workspaceHref('/support')}
              target="_blank"
              rel="noopener noreferrer"
              className="group text-foreground hover:bg-surface-200 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
            >
              <LifeBuoy className="h-4 w-4 opacity-50" />
              Support form
              <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-50" />
            </a>
          </div>
        </div>
      )}

      {/* History view */}
      {view === 'history' && (
        <div className="flex-1 overflow-y-auto">
          {historyLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="text-foreground-muted h-5 w-5 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <Clock className="text-foreground-muted mb-3 h-8 w-8" />
              <p className="text-foreground-lighter text-sm">No chat history yet</p>
            </div>
          ) : (
            <div className="p-2">
              {history.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className="text-foreground hover:bg-surface-200 flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors"
                >
                  <span className="truncate text-sm">{conv.preview || 'Conversation'}</span>
                  <span className="text-foreground-muted text-xs">
                    {formatTimestamp(conv.updated_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat view */}
      {view === 'chat' && (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="text-foreground-muted h-5 w-5 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <MessageSquare className="text-foreground-muted mb-3 h-8 w-8" />
                <p className="text-foreground-lighter text-sm">How can I help?</p>
                <p className="text-foreground-muted mt-1 text-xs">
                  Ask about features, billing, agents, or troubleshooting.
                </p>
              </div>
            ) : null}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    msg.role === 'user' ? 'bg-brand text-black' : 'bg-surface-200 text-foreground'
                  }`}
                >
                  {msg.content ? (
                    msg.role === 'assistant' ? (
                      <FormattedMessage text={msg.content} />
                    ) : (
                      msg.content
                    )
                  ) : streaming && i === messages.length - 1 ? (
                    <span className="text-foreground-muted">Thinking...</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-border shrink-0 border-t px-3 py-2">
            <div className="bg-surface-200 flex items-end gap-2 rounded-lg px-3 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                rows={1}
                className="text-foreground placeholder:text-foreground-muted flex-1 resize-none bg-transparent text-sm leading-[1.5] outline-none"
                style={{ maxHeight: 120, overflowY: 'auto' }}
                disabled={streaming}
              />
              <button
                type="submit"
                disabled={!input.trim() || streaming}
                className="text-brand shrink-0 p-0.5 disabled:opacity-30"
                aria-label="Send message"
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

export function SupportWidget({ children }: { children: ReactNode }) {
  const { open, toggle, close } = useSupportChat();
  const pathname = usePathname();

  // Hide support chat on agent detail pages (they have their own chat)
  const isAgentPage = /\/agents\/[^/]+$/.test(pathname);

  return (
    <>
      {children}

      {!isAgentPage && (
        <>
          {/* Chat panel */}
          {open && (
            <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-x-auto sm:right-6 sm:bottom-20">
              <SupportChat onClose={close} />
            </div>
          )}

          {/* FAB */}
          <button
            onClick={toggle}
            className={`bg-brand hover:bg-brand/90 fixed right-4 bottom-4 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-colors sm:right-6 sm:bottom-6 ${open ? 'max-sm:hidden' : ''}`}
            aria-label={open ? 'Close support chat' : 'Open support chat'}
          >
            {open ? (
              <X className="h-5 w-5 text-black" />
            ) : (
              <MessageSquare className="h-5 w-5 text-black" />
            )}
          </button>
        </>
      )}
    </>
  );
}
