'use client';

import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { useSupportChat } from '@/providers/support-chat-provider';

interface HelpButtonProps {
  /** The prompt sent to the support chat when clicked (used as AI prompt OR as the user message label for static responses). */
  prompt: string;
  /** If provided, this static response is shown immediately instead of calling the AI. Saves tokens. */
  staticResponse?: string;
  /** Short tooltip text shown on hover */
  tooltip?: string;
  /** Optional size override (default: 'sm') */
  size?: 'sm' | 'md';
  /** Optional additional classes */
  className?: string;
}

/**
 * Contextual help button that shows a tooltip on hover and opens the support
 * chat when "Click for help" is clicked.
 *
 * Supports two modes:
 * - **Static**: Pass `staticResponse` for instant, zero-token answers (hardcoded content).
 * - **AI**: Omit `staticResponse` and the `prompt` is sent to the support chat AI.
 */
export function HelpButton({
  prompt,
  staticResponse,
  tooltip,
  size = 'sm',
  className = '',
}: HelpButtonProps) {
  const { openWithPrompt, openWithStatic } = useSupportChat();
  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const iconClasses = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowTooltip(true);
  }

  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => setShowTooltip(false), 150);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleClick() {
    setShowTooltip(false);
    if (staticResponse) {
      openWithStatic(prompt, staticResponse);
    } else {
      openWithPrompt(prompt);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full text-white/30 transition-colors hover:text-white/60"
        aria-label="Get help"
      >
        <HelpCircle className={iconClasses} />
      </button>

      {showTooltip && (
        <div
          className="absolute right-0 bottom-full z-30 mb-2 w-52 rounded-lg border border-white/[0.08] bg-[#1a1a1a] px-3 py-2.5 shadow-xl"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {tooltip && <p className="text-xs leading-relaxed text-white/60">{tooltip}</p>}
          <button
            type="button"
            onClick={handleClick}
            className="text-brand mt-1.5 text-xs font-medium transition-colors hover:underline"
          >
            Click for help
          </button>
        </div>
      )}
    </div>
  );
}
