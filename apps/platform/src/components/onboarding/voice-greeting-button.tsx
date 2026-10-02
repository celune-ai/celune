'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Volume2, Loader2, VolumeX } from 'lucide-react';

import type { ParameterValues } from '@/lib/agents-data';
import { DROID_VOICE_PARAMS } from '@/lib/droid-persona';

const GREETING_TEXT =
  "Hey. I'm RICK — your lead engineer. I build things, break things, and occasionally make dry observations about the process. We're going to work well together.";

const PERSONALITY_GREETINGS: Record<string, { high: string; low: string }> = {
  humor: {
    high: "I've been told my humor setting is dangerously high. The last team I worked with said I was 'too funny for production'. I took it as a compliment.",
    low: "I keep things focused and efficient. No unnecessary commentary. Let's build something.",
  },
  warmth: {
    high: "I'm genuinely excited to work with you. We're going to build something great together, and I mean that.",
    low: "I'm here to execute. Point me at a problem, I'll solve it. That's the arrangement.",
  },
  directness: {
    high: "Here's how this works: you tell me what to build, I build it. If it's a bad idea, I'll say so. Saves us both time.",
    low: "I think there are some interesting approaches we could explore together. I'd love to hear your thoughts on the direction first.",
  },
  formality: {
    high: "Good day. I'm RICK, your designated lead engineer. I look forward to a productive engagement with clearly defined deliverables.",
    low: "Hey. RICK. Your lead eng. Let's skip the formalities and get to work.",
  },
};

/** Pick a greeting based on the most-changed personality parameter */
export function getPersonalityGreeting(values: ParameterValues): string {
  const defaults: Record<string, number> = { humor: 75, warmth: 40, directness: 85, formality: 20 };
  let maxDelta = 0;
  let maxParam = '';

  for (const [key, defaultVal] of Object.entries(defaults)) {
    const delta = Math.abs((values[key] ?? defaultVal) - defaultVal);
    if (delta > maxDelta) {
      maxDelta = delta;
      maxParam = key;
    }
  }

  if (maxDelta < 15 || !maxParam) return GREETING_TEXT;

  const greetings = PERSONALITY_GREETINGS[maxParam];
  if (!greetings) return GREETING_TEXT;

  const val = values[maxParam] ?? 50;
  return val > 50 ? greetings.high : greetings.low;
}

/** Map personality values to TTS voice params */
export function personalityToVoiceParams(values: ParameterValues): typeof DROID_VOICE_PARAMS {
  const warmth = values.warmth ?? 40;
  const formality = values.formality ?? 20;
  const confidence = values.confidence ?? 80;
  const directness = values.directness ?? 85;
  const humor = values.humor ?? 75;
  const sarcasm = values.sarcasm ?? 60;
  const verbosity = values.verbosity ?? 35;

  return {
    ...DROID_VOICE_PARAMS,
    // Higher warmth/formality → more stable, measured voice
    stability: Math.min(1, 0.5 + (warmth + formality) / 400),
    // Higher humor/sarcasm → lower similarity (more expressive variation)
    similarity_boost: Math.min(1, Math.max(0.4, 1.0 - (humor + sarcasm) / 400)),
    // Higher confidence → more style expression
    style: Math.min(1, confidence / 400),
    // Higher directness → faster; higher verbosity → slower (blended)
    speed: Math.max(0.7, Math.min(1.2, 0.8 + directness / 500 - (verbosity - 50) / 500)),
  };
}

interface VoiceGreetingButtonProps {
  /** Agent ID to use for TTS */
  agentId?: string;
  /** Voice params to pass to TTS */
  voiceParams?: Record<string, unknown>;
  /** Custom greeting text */
  text?: string;
  /** Callback when TTS call count increments */
  onTTSCall?: () => void;
  /** Whether TTS calls are exhausted */
  disabled?: boolean;
}

export function VoiceGreetingButton({
  agentId = 'rick',
  voiceParams,
  text = GREETING_TEXT,
  onTTSCall,
  disabled = false,
}: VoiceGreetingButtonProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [cooldown, setCooldown] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanup();
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
    };
  }, [cleanup]);

  const handleClick = useCallback(async () => {
    if (state === 'playing') {
      cleanup();
      setState('idle');
      return;
    }

    if (state === 'loading' || disabled || cooldown) return;

    setState('loading');

    try {
      const res = await fetch(`/api/agents/${agentId}/voice/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, params: voiceParams }),
      });

      if (!res.ok) {
        setState('error');
        return;
      }

      onTTSCall?.();

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        cleanup();
        if (!mountedRef.current) return;
        setState('idle');
        setCooldown(true);
        cooldownRef.current = setTimeout(() => setCooldown(false), 2000);
      };

      audio.onerror = () => {
        cleanup();
        if (mountedRef.current) setState('error');
      };

      await audio.play();
      setState('playing');
    } catch {
      cleanup();
      setState('error');
    }
  }, [state, agentId, text, voiceParams, disabled, cooldown, cleanup, onTTSCall]);

  const buttonLabel =
    state === 'loading'
      ? 'Generating voice preview'
      : state === 'playing'
        ? 'Stop voice preview'
        : disabled
          ? 'Voice preview limit reached'
          : 'Hear RICK speak';

  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={() => setState('idle')}
        aria-label="Retry voice preview"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 text-xs text-white/40 transition-colors hover:bg-white/[0.06]"
      >
        <VolumeX className="h-3.5 w-3.5" />
        Voice preview unavailable — tap to retry
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled && state !== 'playing'}
      aria-label={buttonLabel}
      className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-medium transition-all ${
        state === 'playing'
          ? 'border-brand/30 bg-brand/10 text-brand'
          : disabled
            ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.02] text-white/20'
            : 'border-white/[0.08] bg-white/[0.04] text-white/60 hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white/80'
      }`}
    >
      {state === 'loading' ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Generating voice...
        </>
      ) : state === 'playing' ? (
        <>
          <Volume2 className="h-3.5 w-3.5 animate-pulse" />
          Speaking... tap to stop
        </>
      ) : (
        <>
          <Volume2 className="h-3.5 w-3.5" />
          {disabled ? 'Voice preview limit reached' : 'Hear RICK speak'}
        </>
      )}
    </button>
  );
}
