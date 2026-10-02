'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiUrl } from '@repo/db/api';

interface UseSpeechRecognitionOptions {
  onFinalTranscript?: (text: string) => void;
  /** Silence threshold in ms before sending final transcript (default: 1500). Native mode only. */
  silenceThreshold?: number;
}

interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  /** True when silence debounce is running (native) or Whisper upload is in progress */
  isPendingSend: boolean;
  transcript: string;
  interimText: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  resetTranscript: () => void;
}

// Extend Window for SpeechRecognition types
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;
type RecordingMode = 'native' | 'whisper';

/** Vendor-prefixed browser globals for speech recognition */
interface WindowWithSpeechRecognition {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  MediaRecorder?: unknown;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeechRecognition;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function detectRecordingMode(): RecordingMode | null {
  if (getSpeechRecognition() !== null) return 'native';
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeechRecognition;
  if (w.MediaRecorder) {
    return 'whisper';
  }
  return null;
}

export function useSpeechRecognition(
  options?: UseSpeechRecognitionOptions,
): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isPendingSend, setIsPendingSend] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Defer support check to avoid SSR hydration mismatch
  const [isSupported, setIsSupported] = useState(false);

  /** Detected once on mount; null = unsupported */
  const modeRef = useRef<RecordingMode | null>(null);

  // ─── Native SpeechRecognition refs ──────────────────────────────────────
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const committedRef = useRef('');
  const accumulatedRef = useRef('');
  /** Debounce timer — waits for silence before firing onFinalTranscript */
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Whisper / MediaRecorder refs ───────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const onFinalRef = useRef(options?.onFinalTranscript);
  onFinalRef.current = options?.onFinalTranscript;
  const silenceThresholdRef = useRef(options?.silenceThreshold ?? 1500);
  silenceThresholdRef.current = options?.silenceThreshold ?? 1500;

  // Detect browser support on mount
  useEffect(() => {
    const mode = detectRecordingMode();
    if (mode) {
      modeRef.current = mode;
      setIsSupported(true);
    }
  }, []);

  // ─── Whisper: upload blob ────────────────────────────────────────────────
  const transcribeBlob = useCallback(async (blob: Blob) => {
    if (blob.size === 0) return;
    setIsPendingSend(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      const res = await fetch(apiUrl('/api/voice/transcribe'), {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: 'Transcription failed' }))) as {
          error?: string;
        };
        setError(err.error ?? 'Transcription failed');
        return;
      }
      const data = (await res.json()) as { transcript?: string };
      const text = data.transcript?.trim() ?? '';
      if (text) {
        setTranscript(text);
        onFinalRef.current?.(text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed');
    } finally {
      setIsPendingSend(false);
    }
  }, []);

  // ─── stop ────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (modeRef.current === 'whisper') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        // onstop handler will collect chunks and call transcribeBlob
      }
      setIsListening(false);
      return;
    }

    // Native SpeechRecognition
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setIsPendingSend(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
  }, []);

  // ─── start ───────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (modeRef.current === 'whisper') {
      audioChunksRef.current = [];
      setTranscript('');
      setInterimText('');
      setError(null);

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          streamRef.current = stream;
          const recorder = new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;
          audioChunksRef.current = [];

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };

          recorder.onstop = () => {
            // Release mic
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            mediaRecorderRef.current = null;

            const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            audioChunksRef.current = [];
            void transcribeBlob(blob);
          };

          recorder.start();
          setIsListening(true);
        })
        .catch((e: unknown) => {
          const isDenied = e instanceof DOMException && e.name === 'NotAllowedError';
          setError(
            isDenied
              ? 'Microphone access denied. Check browser permissions.'
              : 'Failed to access microphone.',
          );
        });
      return;
    }

    // ─── Native SpeechRecognition ──────────────────────────────────────────
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    // Stop any existing instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    committedRef.current = '';
    accumulatedRef.current = '';
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setTranscript('');
    setInterimText('');
    setError(null);

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          if (result.isFinal) {
            const finalText = result[0].transcript.trim();
            if (finalText) {
              // Accumulate — user may still be mid-thought
              accumulatedRef.current = accumulatedRef.current
                ? accumulatedRef.current + ' ' + finalText
                : finalText;
            }
            committedRef.current = accumulatedRef.current;
            setTranscript(accumulatedRef.current);
            setInterimText('');
            // Reset debounce timer — wait for more speech
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            setIsPendingSend(true);
            silenceTimerRef.current = setTimeout(() => {
              const accumulated = accumulatedRef.current;
              if (accumulated && onFinalRef.current) {
                onFinalRef.current(accumulated);
              }
              accumulatedRef.current = '';
              silenceTimerRef.current = null;
              setIsPendingSend(false);
            }, silenceThresholdRef.current);
          } else {
            currentInterim += result[0].transcript;
            // User is still speaking — cancel the silence timer
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
              setIsPendingSend(false);
            }
          }
        }
      }

      if (currentInterim) {
        setInterimText(currentInterim);
        setTranscript(committedRef.current + currentInterim);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
      recognitionRef.current = null;
    };

    recognition.onerror = (event) => {
      console.warn('[SpeechRecognition] error:', event.error);
      // These are normal lifecycle events, not real errors
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone access denied. Check browser permissions.');
      } else if (event.error === 'network') {
        setError('Speech recognition requires internet (uses Google servers).');
      } else if (event.error === 'audio-capture') {
        setError('No microphone found. Check your audio input device.');
      } else {
        setError(`Speech error: ${event.error}`);
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error('[SpeechRecognition] start() threw:', e);
      setError('Failed to start speech recognition.');
      recognitionRef.current = null;
    }
  }, [transcribeBlob]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimText('');
    committedRef.current = '';
    accumulatedRef.current = '';
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setIsPendingSend(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    isSupported,
    isListening,
    isPendingSend,
    transcript,
    interimText,
    error,
    start,
    stop,
    resetTranscript,
  };
}
