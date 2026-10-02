'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { VoiceParams } from '@repo/types';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

/** SSE chunk shape from the tts-stream endpoint */
interface StreamChunkEvent {
  audio_base64: string;
  words: WordTimestamp[];
  isFinal: boolean;
  error?: string;
}

interface UseTTSPlaybackOptions {
  agentId: string;
  voiceId: string;
  params?: Partial<VoiceParams>;
  onPlaybackEnd?: () => void;
}

interface UseTTSPlaybackReturn {
  playingIndex: number | null;
  loadingIndex: number | null;
  isSpeaking: boolean;
  isLoadingTTS: boolean;
  /** Index of the currently highlighted word (0-based) during TTS playback */
  highlightWordIndex: number;
  /** High water mark — max word index reached so far (never decreases during a session) */
  maxHighlightIndex: number;
  /** Word timestamps for the currently playing message */
  wordTimestamps: WordTimestamp[];
  playMessage: (text: string, index: number) => void;
  stopPlayback: () => void;
  playText: (text: string) => Promise<void>;
  /** Stream TTS with early playback — tries streaming first, falls back to full fetch */
  playTextStreaming: (text: string) => Promise<void>;
  /** Reset highlight state (call when starting a new conversation turn) */
  resetHighlight: () => void;
  /** Skip to end — mark all words as spoken */
  skipToEnd: () => void;
}

/** Decode base64 string to Uint8Array */
function base64ToBytes(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

export function useTTSPlayback({
  agentId,
  voiceId,
  params,
  onPlaybackEnd,
}: UseTTSPlaybackOptions): UseTTSPlaybackReturn {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [highlightWordIndex, setHighlightWordIndex] = useState(-1);
  const [maxHighlightIndex, setMaxHighlightIndex] = useState(-1);
  const [wordTimestamps, setWordTimestamps] = useState<WordTimestamp[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  onPlaybackEndRef.current = onPlaybackEnd;
  /** Tracks cumulative word offset when playing multiple sentence chunks */
  const wordOffsetRef = useRef(0);

  // Keep maxHighlightIndex in sync with highlightWordIndex (only goes up)
  useEffect(() => {
    if (highlightWordIndex > maxHighlightIndex) {
      setMaxHighlightIndex(highlightWordIndex);
    }
  }, [highlightWordIndex, maxHighlightIndex]);

  const cleanupHighlight = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    // Don't reset highlightWordIndex or maxHighlightIndex here —
    // spoken words should stay highlighted across sentence chunks
    setWordTimestamps([]);
  }, []);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    cleanupHighlight();
  }, [cleanupHighlight]);

  useEffect(() => cleanup, [cleanup]);

  /**
   * Fetch TTS with timestamps and play with word highlighting.
   * Uses the /voice/tts endpoint that returns base64 audio + word timestamps.
   */
  const fetchAndPlayWithTimestamps = useCallback(
    async (text: string, index?: number): Promise<void> => {
      if (!voiceId) return;

      cleanup();
      setIsLoadingTTS(true);
      if (index !== undefined) setLoadingIndex(index);

      try {
        const res = await fetch(`/api/agents/${agentId}/voice/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: voiceId, text, params }),
        });

        if (!res.ok) throw new Error('TTS request failed');

        const data = (await res.json()) as {
          audio_base64: string;
          words: WordTimestamp[];
        };

        // Decode base64 audio to blob
        const binaryStr = atob(data.audio_base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const words = data.words;
        setWordTimestamps(words);

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          setPlayingIndex(null);
          setIsSpeaking(false);
          cleanup();
          onPlaybackEndRef.current?.();
        };

        audio.onerror = () => {
          setPlayingIndex(null);
          setIsSpeaking(false);
          cleanup();
          onPlaybackEndRef.current?.();
        };

        setIsLoadingTTS(false);
        // Capture current offset for this chunk
        const offset = wordOffsetRef.current;
        // Highlight first word immediately before audio starts
        if (words.length > 0) setHighlightWordIndex(offset);
        await audio.play();
        setIsSpeaking(true);
        if (index !== undefined) setPlayingIndex(index);

        // Start word tracking loop
        function trackWords() {
          if (!audioRef.current) return;
          const currentTime = audioRef.current.currentTime;

          // Before the first word starts speaking, keep first word of chunk highlighted
          if (words.length > 0 && currentTime < words[0].start - 0.05) {
            setHighlightWordIndex(offset);
            rafRef.current = requestAnimationFrame(trackWords);
            return;
          }

          // Binary search for the last word whose start time <= currentTime + 50ms lookahead
          const lookAhead = currentTime + 0.05;
          let lo = 0;
          let hi = words.length - 1;
          let idx = 0;
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (words[mid].start <= lookAhead) {
              idx = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          setHighlightWordIndex(offset + idx);
          rafRef.current = requestAnimationFrame(trackWords);
        }
        rafRef.current = requestAnimationFrame(trackWords);
        // Update offset for the next chunk
        wordOffsetRef.current = offset + words.length;
      } catch {
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        cleanupHighlight();
        onPlaybackEndRef.current?.();
      } finally {
        setLoadingIndex(null);
      }
    },
    [agentId, voiceId, params, cleanup, cleanupHighlight],
  );

  /**
   * Fallback: fetch plain audio (no timestamps) for per-message play button.
   */
  const fetchAndPlaySimple = useCallback(
    async (text: string, index?: number): Promise<void> => {
      if (!voiceId) return;

      cleanup();
      setIsLoadingTTS(true);
      if (index !== undefined) setLoadingIndex(index);

      try {
        const res = await fetch(`/api/agents/${agentId}/voice/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: voiceId, text, params }),
        });

        if (!res.ok) throw new Error('TTS request failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          setPlayingIndex(null);
          setIsSpeaking(false);
          cleanup();
          onPlaybackEndRef.current?.();
        };

        audio.onerror = () => {
          setPlayingIndex(null);
          setIsSpeaking(false);
          cleanup();
          onPlaybackEndRef.current?.();
        };

        setIsLoadingTTS(false);
        await audio.play();
        setIsSpeaking(true);
        if (index !== undefined) setPlayingIndex(index);
      } catch {
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        onPlaybackEndRef.current?.();
      } finally {
        setLoadingIndex(null);
      }
    },
    [agentId, voiceId, params, cleanup],
  );

  /** Ref to abort streaming fetch */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Stream TTS — collects all audio chunks from the SSE endpoint first,
   * then plays the complete audio with word-level highlighting.
   *
   * Previous approach tried "early playback" of the first chunk, but the
   * Audio element's onended fired before remaining chunks arrived, causing
   * playback to break after the first few words. For voice-mode sentences
   * (1-3 sentences), collecting all chunks first adds negligible latency
   * and produces seamless playback.
   */
  const playTextStreaming = useCallback(
    async (text: string, index?: number): Promise<void> => {
      if (!voiceId) return;

      cleanup();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoadingTTS(true);
      if (index !== undefined) setLoadingIndex(index);

      try {
        const res = await fetch(`/api/agents/${agentId}/voice/tts-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: voiceId, text, params }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error('Streaming TTS request failed');
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const allChunks: ArrayBuffer[] = [];
        const allWords: WordTimestamp[] = [];

        // Collect all chunks from the stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') continue;

            let event: StreamChunkEvent;
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }

            if (event.error) throw new Error(event.error);

            if (event.audio_base64) {
              allChunks.push(base64ToBytes(event.audio_base64).buffer as ArrayBuffer);
            }

            if (event.words?.length) {
              allWords.push(...event.words);
            }
          }
        }

        // Stream complete — play the full audio
        if (allChunks.length === 0) {
          setIsLoadingTTS(false);
          onPlaybackEndRef.current?.();
          return;
        }

        const offset = wordOffsetRef.current;
        const fullBlob = new Blob(allChunks, { type: 'audio/mpeg' });
        const fullUrl = URL.createObjectURL(fullBlob);
        urlRef.current = fullUrl;

        setWordTimestamps(allWords);
        if (allWords.length > 0) setHighlightWordIndex(offset);

        const audio = new Audio(fullUrl);
        audioRef.current = audio;

        audio.onended = () => {
          setPlayingIndex(null);
          setIsSpeaking(false);
          cleanup();
          onPlaybackEndRef.current?.();
        };

        audio.onerror = () => {
          setPlayingIndex(null);
          setIsSpeaking(false);
          cleanup();
          onPlaybackEndRef.current?.();
        };

        setIsLoadingTTS(false);
        await audio.play();
        setIsSpeaking(true);
        if (index !== undefined) setPlayingIndex(index);

        // Word tracking loop
        function trackWords() {
          if (!audioRef.current) return;
          const currentTime = audioRef.current.currentTime;
          if (allWords.length > 0 && currentTime < allWords[0].start - 0.05) {
            setHighlightWordIndex(offset);
            rafRef.current = requestAnimationFrame(trackWords);
            return;
          }
          const lookAhead = currentTime + 0.05;
          let lo = 0;
          let hi = allWords.length - 1;
          let idx = 0;
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (allWords[mid].start <= lookAhead) {
              idx = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          setHighlightWordIndex(offset + idx);
          rafRef.current = requestAnimationFrame(trackWords);
        }
        rafRef.current = requestAnimationFrame(trackWords);

        wordOffsetRef.current = offset + allWords.length;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setIsSpeaking(false);
        setIsLoadingTTS(false);
        cleanupHighlight();
        // Re-throw so the caller can fall back
        throw err;
      } finally {
        setLoadingIndex(null);
        abortRef.current = null;
      }
    },
    [agentId, voiceId, params, cleanup, cleanupHighlight],
  );

  const playMessage = useCallback(
    (text: string, index: number) => {
      if (playingIndex === index) {
        cleanup();
        setPlayingIndex(null);
        setIsSpeaking(false);
        return;
      }
      // Per-message play uses simple endpoint (faster, no timestamps needed)
      fetchAndPlaySimple(text, index);
    },
    [playingIndex, fetchAndPlaySimple, cleanup],
  );

  const stopPlayback = useCallback(() => {
    abortRef.current?.abort();
    cleanup();
    setPlayingIndex(null);
    setIsSpeaking(false);
    setIsLoadingTTS(false);
  }, [cleanup]);

  const playText = useCallback(
    async (text: string) => {
      // Try streaming first for lower time-to-first-audio, fall back to full fetch
      try {
        await playTextStreaming(text);
      } catch {
        // fetchAndPlayWithTimestamps handles its own errors and calls onPlaybackEnd
        await fetchAndPlayWithTimestamps(text);
      }
    },
    [playTextStreaming, fetchAndPlayWithTimestamps],
  );

  /** Reset all highlight state — call at start of a new conversation turn */
  const resetHighlight = useCallback(() => {
    setHighlightWordIndex(-1);
    setMaxHighlightIndex(-1);
    wordOffsetRef.current = 0;
  }, []);

  /** Skip to end — instantly mark all words as spoken and stop playback */
  const skipToEnd = useCallback(() => {
    // Set to a very high number so all words show as spoken
    setHighlightWordIndex(99999);
    setMaxHighlightIndex(99999);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setPlayingIndex(null);
    setIsSpeaking(false);
    setIsLoadingTTS(false);
    onPlaybackEndRef.current?.();
  }, []);

  return {
    playingIndex,
    loadingIndex,
    isSpeaking,
    isLoadingTTS,
    highlightWordIndex,
    maxHighlightIndex,
    wordTimestamps,
    playMessage,
    stopPlayback,
    playText,
    playTextStreaming,
    resetHighlight,
    skipToEnd,
  };
}
