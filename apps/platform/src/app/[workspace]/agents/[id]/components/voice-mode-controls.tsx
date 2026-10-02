'use client';

import { Mic, Pause, RefreshCw } from 'lucide-react';

export type VoiceConversationState = 'idle' | 'listening' | 'heard' | 'processing' | 'speaking';

interface VoiceModeControlsProps {
  isSupported: boolean;
  conversationState: VoiceConversationState;
  transcript: string;
  interimText: string;
  onToggle: () => void;
  /** Interrupt TTS during speaking — stops audio so user can speak */
  onInterrupt?: () => void;
  agentName: string;
  /** Per-bar mic levels (0–1), driven by useMicLevel hook */
  micLevels?: number[];
  /** Error from speech recognition */
  speechError?: string | null;
}

const STATE_LABELS: Record<VoiceConversationState, string> = {
  idle: 'Tap to start conversation',
  listening: 'Listening…',
  heard: 'Heard you…',
  processing: 'Thinking…',
  speaking: 'Speaking — tap to interrupt',
};

const BAR_COUNT = 24;
const BAR_DOT_SIZE = 3;

export function VoiceModeControls({
  isSupported,
  conversationState,
  transcript,
  interimText,
  onToggle,
  onInterrupt,
  agentName,
  micLevels,
  speechError,
}: VoiceModeControlsProps) {
  if (!isSupported) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-foreground-lighter text-center text-xs">
          Voice input is not supported in this browser. Try Chrome or Edge.
        </p>
      </div>
    );
  }

  const hasError = !!speechError;
  const isActive = conversationState !== 'idle' && !hasError;
  const isListening = conversationState === 'listening' && !hasError;
  const isHeard = conversationState === 'heard';
  const isProcessing = conversationState === 'processing';
  const isSpeaking = conversationState === 'speaking';

  const bars = micLevels && micLevels.length === BAR_COUNT ? micLevels : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8">
      {/* Main mic button with animated ring */}
      <div className="relative flex items-center justify-center">
        {/* Outer glow / background circle */}
        <div
          className={`absolute rounded-full transition-all duration-500 ${
            hasError
              ? 'bg-destructive/8 h-32 w-32'
              : isActive
                ? isHeard || isSpeaking
                  ? 'bg-foreground-muted/8 h-32 w-32'
                  : 'bg-brand/8 h-32 w-32'
                : 'bg-surface-200 h-28 w-28'
          }`}
        />

        {/* Animated SVG ring */}
        <svg className="absolute h-28 w-28" viewBox="0 0 112 112">
          {/* Background track */}
          <circle
            cx="56"
            cy="56"
            r="52"
            fill="none"
            strokeWidth="2"
            className={`transition-all duration-300 ${
              hasError
                ? 'stroke-destructive/30'
                : isActive
                  ? isHeard || isSpeaking
                    ? 'stroke-foreground-muted/20'
                    : 'stroke-brand/20'
                  : 'stroke-surface-300'
            }`}
          />

          {/* Animated arc — visible when active (not in error) */}
          {isActive && (
            <circle
              cx="56"
              cy="56"
              r="52"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className={isHeard || isSpeaking ? 'stroke-foreground-muted' : 'stroke-brand'}
              strokeDasharray={
                isListening ? '80 247' : isHeard ? '327 0' : isSpeaking ? '160 167' : '40 287'
              }
              style={{
                transformOrigin: '56px 56px',
                animation: isHeard
                  ? 'none'
                  : isProcessing
                    ? 'voice-ring-spin 1.2s linear infinite'
                    : isListening
                      ? 'voice-ring-spin 3s linear infinite, voice-ring-breathe 2s ease-in-out infinite'
                      : 'voice-ring-spin 2s linear infinite',
              }}
            />
          )}
        </svg>

        {/* The button */}
        <button
          type="button"
          onClick={isSpeaking && onInterrupt ? onInterrupt : onToggle}
          className={`relative z-10 flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 ${
            hasError
              ? 'bg-destructive/15 border-destructive/30 text-destructive hover:bg-destructive/25 border'
              : isSpeaking
                ? 'bg-surface-300 border-border text-foreground-light hover:bg-surface-400 hover:text-foreground border shadow-lg'
                : isActive
                  ? isHeard
                    ? 'bg-surface-400 shadow-surface-400/25 text-foreground shadow-lg'
                    : 'bg-brand shadow-brand/25 hover:bg-brand/90 text-black shadow-lg'
                  : 'bg-surface-200 text-foreground-light border-border hover:bg-surface-300 hover:text-foreground border'
          }`}
          aria-label={
            hasError
              ? 'Retry voice connection'
              : isSpeaking
                ? 'Pause speech and start talking'
                : isActive
                  ? 'Stop conversation'
                  : 'Start conversation'
          }
        >
          {hasError ? (
            <RefreshCw className="h-8 w-8" />
          ) : isSpeaking ? (
            <Pause className="h-8 w-8" />
          ) : isActive ? (
            <Pause className="h-8 w-8" />
          ) : (
            <Mic className="h-8 w-8" />
          )}
        </button>
      </div>

      {/* Audio level visualizer — row of dots/bars */}
      {isActive && !hasError && (
        <div className="flex h-10 items-center justify-center gap-[3px]">
          {Array.from({ length: BAR_COUNT }, (_, i) => {
            const level = bars ? (bars[i] ?? 0) : 0;
            const height = BAR_DOT_SIZE + level * 25;
            const hasSignal = level > 0.05;
            return (
              <div
                key={i}
                className="rounded-full transition-all duration-75"
                style={{
                  width: `${BAR_DOT_SIZE}px`,
                  height: `${height}px`,
                  backgroundColor: hasSignal
                    ? `hsl(153deg 60% 53% / ${0.4 + level * 0.6})`
                    : 'var(--foreground-muted)',
                  opacity: hasSignal ? 1 : 0.25,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Status label / error message */}
      <div className="flex flex-col items-center gap-1.5">
        {hasError ? (
          <span className="text-destructive text-sm font-medium">{speechError}</span>
        ) : (
          <span
            className={`text-sm font-medium transition-colors ${
              isActive
                ? isHeard
                  ? 'text-foreground-light'
                  : 'text-brand'
                : 'text-foreground-lighter'
            }`}
          >
            {STATE_LABELS[conversationState]}
          </span>
        )}

        {/* Processing dots animation */}
        {isProcessing && !hasError && (
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="bg-brand h-1.5 w-1.5 rounded-full"
                style={{
                  animation: 'voice-dot-bounce 1.4s ease-in-out infinite',
                  animationDelay: `${i * 0.16}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Retry hint when errored */}
      {hasError && (
        <p className="text-foreground-lighter max-w-[220px] text-center text-xs leading-relaxed">
          Tap the button above to retry. Make sure your browser has microphone access.
        </p>
      )}

      {/* Live transcript */}
      {(transcript || interimText) && isActive && !hasError && (
        <div className="w-full max-w-[280px]">
          <div className="bg-surface-100 border-border rounded-xl border px-4 py-3 text-center">
            <p className="text-foreground text-sm leading-relaxed">
              {transcript}
              {interimText && !transcript && (
                <span className="text-foreground-lighter italic">{interimText}</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Subtle hint */}
      {!isActive && !hasError && (
        <p className="text-foreground-lighter max-w-[200px] text-center text-xs leading-relaxed">
          Talk with {agentName} using your voice. Responses will be spoken back.
        </p>
      )}

      {/* Keyframe animations: voice-ring-spin, voice-ring-breathe, voice-dot-bounce defined in theme.css */}
    </div>
  );
}
