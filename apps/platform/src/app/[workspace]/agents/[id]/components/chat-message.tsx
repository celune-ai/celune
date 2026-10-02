'use client';

import { useState, useRef, useMemo } from 'react';
import { Volume2, Loader2, Square, FastForward } from 'lucide-react';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatMessageProps {
  message: Message;
  index?: number;
  playingIndex?: number | null;
  loadingIndex?: number | null;
  onPlay?: (text: string, index: number) => void;
  onSkipToEnd?: () => void;
  /** Current word index being spoken (-1 = none) */
  highlightWordIndex?: number;
  /** High water mark — max word ever reached (words stay colored permanently) */
  maxHighlightIndex?: number;
  /** Whether this specific message is the one being TTS'd with highlighting */
  isHighlighting?: boolean;
}

/** Split text into words matching the TTS route's word splitting (split on whitespace, clean words) */
function splitIntoWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function ChatMessage({
  message,
  index,
  playingIndex,
  loadingIndex,
  onPlay,
  onSkipToEnd,
  highlightWordIndex = -1,
  maxHighlightIndex = -1,
  isHighlighting = false,
}: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isPlaying = index !== undefined && playingIndex === index;
  const isLoading = index !== undefined && loadingIndex === index;
  const [pulses, setPulses] = useState<number[]>([]);
  const nextId = useRef(0);

  // Split content into words for highlighting
  const words = useMemo(() => splitIntoWords(message.content), [message.content]);

  const handlePlay = () => {
    if (!onPlay || index === undefined) return;
    const id = nextId.current++;
    setPulses((prev) => [...prev, id]);
    setTimeout(() => setPulses((prev) => prev.filter((p) => p !== id)), 600);
    onPlay(message.content, index);
  };

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[80%] overflow-hidden rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand rounded-br-sm text-black'
            : 'bg-surface-200 text-foreground rounded-bl-sm'
        }`}
      >
        {/* Pulse ripples on play */}
        {pulses.map((id) => (
          <span
            key={id}
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              background:
                'radial-gradient(circle at center, hsl(153deg 60% 53% / 0.35) 0%, transparent 70%)',
              animation: 'speaker-pulse 0.6s ease-out forwards',
            }}
          />
        ))}

        {/* Message content — with optional word highlighting */}
        {isHighlighting && !isUser ? (
          <p className="relative z-10 break-words whitespace-pre-wrap">
            {words.map((word, i) => {
              // Use maxHighlightIndex for permanent coloring (never un-colors)
              const isSpoken = maxHighlightIndex >= 0 && i <= maxHighlightIndex;
              const isCurrent = i === highlightWordIndex;
              return (
                <span key={i}>
                  {i > 0 && ' '}
                  <span
                    className={`transition-colors duration-75 ${
                      isCurrent
                        ? 'text-brand font-medium'
                        : isSpoken
                          ? 'text-brand/80'
                          : 'text-foreground'
                    }`}
                  >
                    {word}
                  </span>
                </span>
              );
            })}
          </p>
        ) : (
          <p className="relative z-10 break-words whitespace-pre-wrap">{message.content}</p>
        )}

        {!isUser && message.content && onPlay && index !== undefined && (
          <div className="relative z-10 mt-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={handlePlay}
              className="border-border text-foreground-lighter hover:text-brand hover:border-brand/40 flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors"
              aria-label={isPlaying ? 'Stop playback' : 'Play message'}
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isPlaying ? (
                <Square className="h-3 w-3" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
              {isPlaying ? 'Stop' : 'Play'}
            </button>
            {isPlaying && onSkipToEnd && (
              <button
                type="button"
                onClick={onSkipToEnd}
                className="text-foreground-lighter hover:text-brand hover:bg-brand/10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md transition-colors"
                aria-label="Skip to end"
              >
                <FastForward className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Keyframe animation: speaker-pulse defined in theme.css */}
      </div>
    </div>
  );
}
