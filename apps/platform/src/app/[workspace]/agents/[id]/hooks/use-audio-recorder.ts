'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface RecordedClip {
  blob: Blob;
  duration: number;
  url: string;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  audioLevel: number;
  clips: RecordedClip[];
  currentDuration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  removeClip: (index: number) => void;
  clearClips: () => void;
}

const MIN_CLIP_DURATION = 3; // seconds

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [clips, setClips] = useState<RecordedClip[]>([]);
  const [currentDuration, setCurrentDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      clips.forEach((c) => URL.revokeObjectURL(c.url));
    };
    // Only run cleanup on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    // Calculate RMS level normalized to 0-1
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += (data[i]! / 255) ** 2;
    }
    const rms = Math.sqrt(sum / data.length);
    setAudioLevel(Math.min(1, rms * 3)); // Amplify for visual effect

    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for level meter
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up recorder
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;

        if (elapsed >= MIN_CLIP_DURATION) {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
          const url = URL.createObjectURL(blob);
          setClips((prev) => [...prev, { blob, duration: elapsed, url }]);
        }

        // Cleanup
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        audioCtx.close();
        analyserRef.current = null;
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        setAudioLevel(0);
        setCurrentDuration(0);
      };

      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start(250); // Collect data every 250ms
      setIsRecording(true);

      // Start level meter
      updateLevel();

      // Track duration
      durationIntervalRef.current = setInterval(() => {
        setCurrentDuration((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch {
      // Mic access denied or not available
    }
  }, [updateLevel]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    setIsRecording(false);
  }, []);

  const removeClip = useCallback((index: number) => {
    setClips((prev) => {
      const clip = prev[index];
      if (clip) URL.revokeObjectURL(clip.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearClips = useCallback(() => {
    setClips((prev) => {
      prev.forEach((c) => URL.revokeObjectURL(c.url));
      return [];
    });
  }, []);

  return {
    isRecording,
    audioLevel,
    clips,
    currentDuration,
    startRecording,
    stopRecording,
    removeClip,
    clearClips,
  };
}
