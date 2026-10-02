'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Mic, Square, Loader2, Brain } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';

interface MicButtonProps {
  onTranscript: (transcript: string) => void;
  processing?: boolean;
}

const BRAIN_DUMP_WORD_THRESHOLD = 15;
const BRAIN_DUMP_SILENCE_MS = 3000;
const DEFAULT_SILENCE_MS = 1500;

export function MicButton({ onTranscript, processing = false }: MicButtonProps) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const handleFinalTranscript = useCallback(
    (text: string) => {
      onTranscript(text);
      setShowTranscript(false);
      setElapsed(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    },
    [onTranscript],
  );

  // Detect brain dump mode based on word count
  const [wordCount, setWordCount] = useState(0);
  const isBrainDump = wordCount >= BRAIN_DUMP_WORD_THRESHOLD;
  const silenceThreshold = isBrainDump ? BRAIN_DUMP_SILENCE_MS : DEFAULT_SILENCE_MS;

  const { isSupported, isListening, isPendingSend, transcript, interimText, error, start, stop } =
    useSpeechRecognition({
      onFinalTranscript: handleFinalTranscript,
      silenceThreshold,
    });

  // Track word count
  useEffect(() => {
    const text = [transcript, interimText].filter(Boolean).join(' ');
    setWordCount(text.split(/\s+/).filter(Boolean).length);
  }, [transcript, interimText]);

  // Timer for brain dump
  useEffect(() => {
    if (isListening) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isListening]);

  const handleClick = useCallback(() => {
    if (processing || isPendingSend) return;
    if (isListening) {
      stop();
      setShowTranscript(false);
    } else {
      start();
      setShowTranscript(true);
    }
  }, [isListening, processing, start, stop]);

  // Keyboard shortcut: Cmd+Shift+V
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'v') {
        e.preventDefault();
        handleClick();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClick]);

  // Scroll transcript to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript, interimText]);

  const formattedTime = useMemo(() => {
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, [elapsed]);

  if (!isSupported) return null;

  const displayText = [transcript, interimText].filter(Boolean).join(' ');

  return (
    <div className="relative">
      {/* Mic button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={processing || isPendingSend}
        aria-label={isListening ? 'Stop recording' : 'Voice input'}
        aria-pressed={isListening}
        title={
          isPendingSend
            ? 'Transcribing…'
            : isListening
              ? 'Stop recording'
              : 'Voice input (⌘/Ctrl+⇧+V)'
        }
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all',
          isListening
            ? isBrainDump
              ? 'animate-pulse border-purple-500/60 bg-purple-500/20 text-purple-400'
              : 'animate-pulse border-red-500/60 bg-red-500/10 text-red-400'
            : processing || isPendingSend
              ? 'border-border bg-surface-200 text-foreground-lighter cursor-wait'
              : 'border-border bg-surface-200 text-foreground-lighter hover:bg-surface-300 hover:text-foreground',
        )}
      >
        {processing || isPendingSend ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isListening && isBrainDump ? (
          <Brain className="h-4 w-4" />
        ) : isListening ? (
          <Square className="h-3 w-3 fill-current" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>

      {/* Transcript popover */}
      {showTranscript && (isListening || displayText) && (
        <div
          role="status"
          aria-live="polite"
          className="border-border bg-surface-200 absolute right-0 bottom-full z-50 mb-2 w-80 rounded-lg border p-3 shadow-lg"
        >
          <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-2 w-2 animate-pulse rounded-full',
                  isBrainDump ? 'bg-purple-500' : 'bg-red-500',
                )}
              />
              <span className="text-foreground-lighter text-xs font-medium tracking-wider uppercase">
                {isBrainDump ? 'Brain Dump' : 'Listening…'}
              </span>
            </div>
            {isListening && (
              <span className="text-foreground-lighter font-mono text-xs tabular-nums">
                {formattedTime}
              </span>
            )}
          </div>
          <div
            ref={transcriptRef}
            className="text-foreground max-h-40 overflow-y-auto text-sm leading-relaxed"
          >
            {displayText || <span className="text-foreground-lighter italic">Start speaking…</span>}
          </div>
          {isBrainDump && (
            <p className="mt-1.5 text-xs text-purple-400/80">
              Brain dump mode — extended silence threshold active
            </p>
          )}
          {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
