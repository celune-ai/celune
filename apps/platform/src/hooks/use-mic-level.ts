'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const BAR_COUNT = 32;

/**
 * Taps into the microphone via Web Audio API and returns per-bar levels
 * (0–1) updated every animation frame. Starts/stops with the `active` flag.
 */
export function useMicLevel(active: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      ctxRef.current.close().catch(() => {
        /* AudioContext may already be closed */
      });
      ctxRef.current = null;
    }
    analyserRef.current = null;
    setLevels(new Array(BAR_COUNT).fill(0));
  }, []);

  useEffect(() => {
    if (!active) {
      cleanup();
      return;
    }

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = new AudioContext();
        ctxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64; // 32 frequency bins — enough for our bar count
        analyser.smoothingTimeConstant = 0.6;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        sourceRef.current = source;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function tick() {
          if (cancelled) return;
          analyser.getByteFrequencyData(dataArray);

          // Map frequency bins to our bar count, normalize to 0–1
          const bars: number[] = [];
          const binCount = dataArray.length;
          for (let i = 0; i < BAR_COUNT; i++) {
            const binIndex = Math.floor((i / BAR_COUNT) * binCount);
            bars.push((dataArray[binIndex] ?? 0) / 255);
          }
          setLevels(bars);
          rafRef.current = requestAnimationFrame(tick);
        }

        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // getUserMedia denied or unavailable — stay silent
      }
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active, cleanup]);

  return levels;
}
