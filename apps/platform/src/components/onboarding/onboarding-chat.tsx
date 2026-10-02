'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Loader2, Send, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/dialog';
import { PARAMETERS, type ParameterValues } from '@/lib/agents-data';
import { apiUrl } from '@repo/db/api';

import { useOnboardingChatRealtime } from '@/hooks/use-onboarding-chat-realtime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/** Which personality params appear in the chat tuning popover */
const CHAT_TUNABLE_PARAMS = new Set(['humor', 'warmth', 'directness', 'formality', 'verbosity']);

interface OnboardingChatProps {
  workspaceId: string;
  onComplete: () => void;
  onSkip: () => void;
  onBack?: () => void;
  avatarUrl?: string | null;
  agentName?: string;
  userName?: string;
  personalityValues?: Record<string, number>;
  onPersonalityChange?: (values: Record<string, number>) => void;
}

// ---------------------------------------------------------------------------
// Strip memory tags from displayed text
// ---------------------------------------------------------------------------

function stripMemoryTags(text: string): string {
  return text.replace(/\[MEMORY:[^\]]+\]/g, '').trim();
}

// ---------------------------------------------------------------------------
// + Divider — matches the marketing site grid-frame SectionDivider
// ---------------------------------------------------------------------------

function ChatDivider() {
  return (
    <div className="flex items-center">
      <span
        className="-ml-[3px] shrink-0 text-xs leading-none text-neutral-700 select-none"
        aria-hidden="true"
      >
        +
      </span>
      <div className="flex-1 border-t border-dashed border-white/[0.08]" />
      <span
        className="-mr-[3px] shrink-0 text-xs leading-none text-neutral-700 select-none"
        aria-hidden="true"
      >
        +
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skip button with confirmation dialog
// ---------------------------------------------------------------------------

function SkipButton({ onSkip }: { onSkip: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 border-white/20 bg-transparent text-white/60 hover:bg-white/5 hover:text-white"
        aria-label="Skip conversation"
      >
        Skip
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-white/10 bg-[#141414] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Skip the conversation?</DialogTitle>
            <DialogDescription className="text-white/60">
              This conversation helps your lead agent understand you so it can set up initial
              projects, suggest workflows, and tailor its responses. If you skip, you&apos;ll start
              from a blank workspace with no personalized setup.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
            >
              Keep going
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                onSkip();
              }}
              className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
            >
              Skip anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Progress bar — tracks user exchanges out of 10
// ---------------------------------------------------------------------------

const REQUIRED_QUESTIONS = 5;

function OnboardingProgressBar({ count, onContinue }: { count: number; onContinue?: () => void }) {
  const reached = count >= REQUIRED_QUESTIONS;
  const progress = Math.min(count / REQUIRED_QUESTIONS, 1);

  return (
    <div className="flex w-full items-center gap-3">
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/20">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${reached ? 'bg-emerald-400' : 'bg-white'}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span
        className={`shrink-0 text-xs tabular-nums ${reached ? 'text-emerald-400' : 'text-white/60'}`}
      >
        {count}/{REQUIRED_QUESTIONS}
      </span>
      {reached && onContinue && (
        <Button
          onClick={onContinue}
          size="sm"
          className="animate-fade-in ml-1 gap-1.5 text-xs text-black"
        >
          Continue
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typing animation intro screen
// ---------------------------------------------------------------------------

function OnboardingIntro({
  onStart,
  onBack,
  onSkip,
  agentName,
  avatarUrl,
}: {
  onStart: () => void;
  onBack?: () => void;
  onSkip: () => void;
  agentName: string;
  avatarUrl: string;
}) {
  const displayName = agentName || 'RICK';
  const [showText, setShowText] = useState(false);
  const [showAvatar, setShowAvatar] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setShowText(true), 100),
      setTimeout(() => setShowAvatar(true), 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex h-full w-full flex-col pt-12">
      <div
        className="mx-auto flex flex-1 flex-col justify-center px-8"
        style={{ maxWidth: 'calc(42rem + 64px)', width: '100%' }}
      >
        <div
          className="flex flex-col transition-opacity duration-700 ease-out"
          style={{ opacity: showText ? 1 : 0 }}
        >
          <h2 className="text-4xl font-light tracking-tight text-white lg:text-5xl">
            {displayName} has a few questions
          </h2>

          <p className="mt-8 mb-10 max-w-lg text-base leading-relaxed font-light text-white/80">
            Answer at least 5 questions to set up your workspace, but we highly recommend answering
            all 10 or even continuing beyond. The more you and your agent discuss now, the quicker
            you&apos;ll be off to the races.
          </p>

          <Button onClick={onStart} className="w-fit gap-2 px-10 py-4 text-lg font-bold text-black">
            Start Conversation
            <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personality tuning dialog — opens when clicking RICK's avatar
// ---------------------------------------------------------------------------

function PersonalityDialog({
  open,
  onOpenChange,
  values,
  onChange,
  agentName,
  avatarUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: Record<string, number>;
  onChange: (values: Record<string, number>) => void;
  agentName: string;
  avatarUrl: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#141414] sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Image
              src={avatarUrl}
              alt={agentName}
              className="h-10 w-10 rounded-full object-cover ring-1 ring-white/20"
              width={40}
              height={40}
              unoptimized
            />
            <div>
              <DialogTitle className="text-white">{agentName}</DialogTitle>
              <DialogDescription className="text-white/50">
                Adjust personality. Changes apply on the next response.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          {PARAMETERS.filter((p) => CHAT_TUNABLE_PARAMS.has(p.id)).map((param) => {
            const val = values[param.id] ?? 50;
            return (
              <div key={param.id} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm font-medium text-white/70">
                  {param.label}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={val}
                  aria-label={`${param.label} setting`}
                  onChange={(e) => {
                    onChange({ ...values, [param.id]: Number(e.target.value) });
                  }}
                  className="bio-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/[0.08] accent-[var(--color-brand)]"
                />
                <span className="w-7 shrink-0 text-right text-xs font-medium text-white/60 tabular-nums">
                  {val}
                </span>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Component — Full-screen wizard-style conversation
// ---------------------------------------------------------------------------

const DEFAULT_AVATAR = '/avatars/bots/bot1.jpg';

export function OnboardingChat({
  workspaceId,
  onComplete,
  onSkip,
  onBack,
  avatarUrl,
  agentName = 'RICK',
  userName,
  personalityValues,
  onPersonalityChange,
}: OnboardingChatProps) {
  const agentAvatar = avatarUrl || DEFAULT_AVATAR;
  const displayName = agentName || 'RICK';
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showPersonalityPopover, setShowPersonalityPopover] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track that we're the source of a message (so realtime doesn't double-add it)
  const pendingWebMessageRef = useRef(false);

  // Subscribe to realtime — messages from MCP appear here
  useOnboardingChatRealtime({
    conversationId,
    onNewMessage: useCallback((msg) => {
      // Skip messages we sent from this web UI (avoid duplicates)
      if (pendingWebMessageRef.current) return;
      const sourceChannel = msg.metadata?.source_channel;
      if (sourceChannel === 'web') return;

      const cleaned = msg.role === 'assistant' ? stripMemoryTags(msg.content) : msg.content;
      setMessages((prev) => [...prev, { role: msg.role, content: cleaned }]);

      // Check for completion
      if (
        msg.role === 'assistant' &&
        msg.content.includes('[MEMORY:context:onboarding-complete:true]')
      ) {
        setIsComplete(true);
      }
    }, []),
  });

  // Auto-start: hydrate from DB or send opening message
  const startConversation = useCallback(async () => {
    setStarted(true);

    // Check for existing conversation (may have messages from MCP)
    try {
      const hydrationRes = await fetch(
        apiUrl(`/api/onboarding/conversation?workspace_id=${workspaceId}`),
      );
      if (hydrationRes.ok) {
        const data = await hydrationRes.json();
        if (data.conversation_id && data.messages?.length > 0) {
          setConversationId(data.conversation_id);
          // Filter out the initial "Hi" and strip memory tags
          const hydrated = (data.messages as { role: string; content: string }[])
            .filter((m) => !(m.role === 'user' && m.content === 'Hi'))
            .map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.role === 'assistant' ? stripMemoryTags(m.content) : m.content,
            }));
          if (hydrated.length > 0) {
            setMessages(hydrated);
            inputRef.current?.focus();
            return;
          }
        }
      }
    } catch {
      // Failed to hydrate — start fresh
    }

    // No existing conversation — start a new one
    setStreaming(true);
    setStreamingText('');

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch(apiUrl('/api/onboarding/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          messages: [{ role: 'user', content: 'Hi' }],
          personality_values: personalityValues,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let errMsg = 'Failed to connect. Please try again.';
        try {
          const errBody = await res.json();
          if (
            res.status === 402 ||
            errBody?.error?.includes('API key') ||
            errBody?.error?.includes('credit balance')
          ) {
            errMsg = 'PROVIDER_KEY_ERROR';
          } else if (errBody?.error) {
            errMsg = errBody.error;
          }
        } catch {
          // couldn't parse error body
        }
        setError(errMsg);
        setStreaming(false);
        return;
      }

      // Capture conversation ID from response header
      const respConvId = res.headers.get('X-Conversation-Id');
      if (respConvId) setConversationId(respConvId);

      setError(null);
      let fullText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamingText(stripMemoryTags(fullText));
      }

      // Check if the response is an error payload (our own or raw provider error)
      if (fullText.startsWith('{')) {
        try {
          const errPayload = JSON.parse(fullText);
          if (errPayload.__error) {
            setError(errPayload.billing ? 'PROVIDER_KEY_ERROR' : errPayload.message);
            setStreamingText('');
            setStreaming(false);
            return;
          }
          if (errPayload.type === 'error' || errPayload.error) {
            const msg = errPayload.error?.message || errPayload.message || 'Something went wrong';
            const isOverloaded = msg.includes('Overloaded') || msg.includes('overloaded');
            const isBilling = msg.includes('credit balance') || msg.includes('billing');
            setError(
              isBilling
                ? 'PROVIDER_KEY_ERROR'
                : isOverloaded
                  ? 'AI provider is temporarily overloaded. Please retry in a moment.'
                  : msg,
            );
            setStreamingText('');
            setStreaming(false);
            return;
          }
        } catch {
          // Not valid JSON — treat as normal text
        }
      }

      const cleaned = stripMemoryTags(fullText);
      setMessages([{ role: 'assistant', content: cleaned }]);
      setStreamingText('');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = 'Something went wrong starting the conversation. Please try again.';
      setError(msg);
      // Error is shown inline — no toast during onboarding
    } finally {
      setStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [workspaceId]);

  // Focus input when streaming completes
  useEffect(() => {
    if (!streaming && started && inputRef.current) {
      inputRef.current.focus();
    }
  }, [streaming, started]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setStreaming(true);
    setStreamingText('');
    // Flag so realtime doesn't double-add our own messages
    pendingWebMessageRef.current = true;

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      // Build API messages array (include the initial hidden "Hi" message)
      const apiMessages = [
        { role: 'user' as const, content: 'Hi' },
        ...newMessages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch(apiUrl('/api/onboarding/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          messages: apiMessages,
          personality_values: personalityValues,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError('Failed to send message. Please try again.');
        setStreaming(false);
        return;
      }

      // Capture conversation ID if not already set
      const respConvId = res.headers.get('X-Conversation-Id');
      if (respConvId && !conversationId) setConversationId(respConvId);

      setError(null);
      let fullText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setStreamingText(stripMemoryTags(fullText));
      }

      // Check if the response is an error payload (our own or raw Anthropic/provider error)
      if (fullText.startsWith('{')) {
        try {
          const errPayload = JSON.parse(fullText);
          if (errPayload.__error) {
            setError(errPayload.billing ? 'PROVIDER_KEY_ERROR' : errPayload.message);
            setStreamingText('');
            setStreaming(false);
            return;
          }
          if (errPayload.type === 'error' || errPayload.error) {
            const msg = errPayload.error?.message || errPayload.message || 'Something went wrong';
            const isOverloaded = msg.includes('Overloaded') || msg.includes('overloaded');
            const isBilling = msg.includes('credit balance') || msg.includes('billing');
            setError(
              isBilling
                ? 'PROVIDER_KEY_ERROR'
                : isOverloaded
                  ? 'AI provider is temporarily overloaded. Please retry in a moment.'
                  : msg,
            );
            setStreamingText('');
            setStreaming(false);
            return;
          }
        } catch {
          // Not valid JSON — treat as normal text
        }
      }

      const cleaned = stripMemoryTags(fullText);
      const complete = fullText.includes('[MEMORY:context:onboarding-complete:true]');

      setMessages([...newMessages, { role: 'assistant', content: cleaned }]);
      setStreamingText('');

      if (complete) {
        setIsComplete(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = 'Failed to send message. Please try again.';
      setError(msg);
      // Error is shown inline — no toast during onboarding
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Allow realtime messages again after a short delay
      // (DB write may arrive slightly after streaming completes)
      setTimeout(() => {
        pendingWebMessageRef.current = false;
      }, 2000);
    }
  }, [input, messages, streaming, workspaceId, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Track whether the scroll container has overflowed (content reached the avatar)
  const [hasOverflow, setHasOverflow] = useState(false);

  // Auto-scroll to bottom when messages change + detect overflow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setHasOverflow(el.scrollHeight > el.clientHeight);
  }, [messages, streaming]);

  // Listen for scroll to update overflow state
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setHasOverflow(el.scrollHeight > el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [started]);

  // User's first initial for avatar
  const userInitial = userName ? userName[0].toUpperCase() : '?';

  // Pre-start state — show the opening prompt with typing animation
  if (!started) {
    return (
      <OnboardingIntro
        onStart={startConversation}
        onBack={onBack}
        onSkip={onSkip}
        agentName={agentName}
        avatarUrl={agentAvatar}
      />
    );
  }

  // Count user messages (excluding the hidden "Hi" opener)
  const questionCount = messages.filter((m) => m.role === 'user').length;

  return (
    <div className="relative flex h-full w-full flex-col pt-14">
      {/* Progress bar */}
      <div className="w-full shrink-0 border-y border-white/[0.06] px-6 py-5">
        <OnboardingProgressBar count={questionCount} onContinue={onComplete} />
      </div>

      {/* Chat container — spans to bottom */}
      <div className="relative flex min-h-0 w-full flex-1 flex-col">
        {/* Fade gradient at top of chat — only when scrolled */}
        {hasOverflow && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20"
            style={{
              background: 'linear-gradient(to bottom, rgb(10 10 10 / 1), rgb(10 10 10 / 0))',
            }}
          />
        )}

        {/* Scrollable message area — fills remaining space to bottom */}
        <div
          ref={scrollRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 pb-6"
        >
          {/* Spacer — pushes first message to the bottom */}
          <div className="flex-1" />

          {/* Messages — linear flow with avatars */}
          <div className="space-y-6">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 ${
                  i === messages.length - 1 && msg.role === 'assistant' ? 'animate-fade-in' : ''
                }`}
              >
                {/* Avatar — click agent avatar to tune personality */}
                {msg.role === 'assistant' ? (
                  <button
                    type="button"
                    onClick={() => setShowPersonalityPopover(true)}
                    className="group relative shrink-0 cursor-pointer rounded-full"
                    title="Tune personality"
                  >
                    <Image
                      src={agentAvatar}
                      alt={displayName}
                      className="h-8 w-8 rounded-full object-cover ring-1 ring-white/20 transition-all group-hover:ring-[var(--color-brand)]/60"
                      width={32}
                      height={32}
                      unoptimized
                    />
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <SlidersHorizontal className="h-3 w-3 text-white" />
                    </div>
                  </button>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-black ring-1 ring-white/20">
                    {userInitial}
                  </div>
                )}
                {/* Message content — left-aligned */}
                <div className="min-w-0 flex-1">
                  <span className="mb-1 block text-sm font-bold text-white">
                    {msg.role === 'assistant' ? displayName : userName || 'You'}
                  </span>
                  <p className="text-base leading-relaxed text-white/90">{msg.content}</p>
                </div>
              </div>
            ))}

            {/* Streaming loader */}
            {streaming && (
              <div className="flex items-start gap-3">
                <Image
                  src={agentAvatar}
                  alt={displayName}
                  className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/20"
                  width={32}
                  height={32}
                  unoptimized
                />
                <div className="pt-1">
                  <span className="mb-1 block text-sm font-bold text-white">{displayName}</span>
                  <div className="mt-2 flex gap-1">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-white/40"
                      style={{
                        animation: 'onboarding-bounce 1.4s ease-in-out infinite',
                        animationDelay: '0s',
                      }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-white/40"
                      style={{
                        animation: 'onboarding-bounce 1.4s ease-in-out infinite',
                        animationDelay: '0.2s',
                      }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-white/40"
                      style={{
                        animation: 'onboarding-bounce 1.4s ease-in-out infinite',
                        animationDelay: '0.4s',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error state */}
          {error &&
            !streaming &&
            (error === 'PROVIDER_KEY_ERROR' ? (
              <div className="animate-fade-in mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 px-5 py-4">
                <p className="text-sm font-medium text-amber-400">Your API key needs attention</p>
                <p className="mt-1.5 text-xs leading-relaxed text-amber-400/70">
                  Your Anthropic API key doesn&apos;t have enough credits. Add credits at{' '}
                  <a
                    href="https://console.anthropic.com/settings/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline transition-colors hover:text-amber-300"
                  >
                    console.anthropic.com
                  </a>{' '}
                  or go back and connect a different key.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onBack}
                    className="gap-1.5 border-amber-500/20 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Update API Key
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setError(null);
                      if (messages.length === 0) startConversation();
                      else sendMessage();
                    }}
                    className="gap-1.5 border-white/10 text-white/60 hover:text-white"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div className="animate-fade-in mt-6 flex items-center gap-3">
                <p className="text-sm text-red-400">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    if (messages.length === 0) startConversation();
                    else sendMessage();
                  }}
                  className="gap-2 border-white/10 text-white/60 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            ))}

          {/* Completion state */}
          {isComplete && !streaming && (
            <div className="animate-fade-in mt-6 mb-4 flex justify-center">
              <Button onClick={onComplete} className="gap-2 px-8 py-3 text-base text-black">
                Finish Intro Conversation
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>
          )}
        </div>

        {/* Input divider with + marks */}
        {!isComplete && <ChatDivider />}

        {/* Input area — at the very bottom */}
        {!isComplete && (
          <div className="shrink-0 px-6 py-4">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e.target);
                }}
                onKeyDown={handleKeyDown}
                placeholder={streaming ? '' : 'Type your response...'}
                disabled={streaming}
                rows={1}
                className="w-full resize-none overflow-hidden rounded-xl border border-white/[0.12] bg-[#141414] px-5 pt-4 pr-14 pb-5 text-base leading-relaxed text-white transition-colors placeholder:text-white/80 focus:border-white/20 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={streaming || !input.trim()}
                className={`absolute right-3 bottom-3 rounded-lg p-2 transition-colors ${
                  input.trim() && !streaming
                    ? 'bg-brand hover:bg-brand/80 text-black'
                    : 'text-white/30 disabled:opacity-30'
                }`}
              >
                {streaming ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
            <div className="mt-2 px-1 text-right">
              <span className="text-xs text-white">Press Enter to send</span>
            </div>
          </div>
        )}
      </div>

      {/* Personality tuning dialog */}
      {personalityValues && (
        <PersonalityDialog
          open={showPersonalityPopover}
          onOpenChange={setShowPersonalityPopover}
          values={personalityValues}
          onChange={(v) => onPersonalityChange?.(v)}
          agentName={displayName}
          avatarUrl={agentAvatar}
        />
      )}

      {/* Fade-in animation */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
      `}</style>
    </div>
  );
}
