'use client';

import { useState, useCallback } from 'react';
import {
  ArrowLeft,
  Mic,
  MicOff,
  Upload,
  Trash2,
  Loader2,
  Check,
  Play,
  Square,
  Volume2,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { useAudioRecorder, type RecordedClip } from '../hooks/use-audio-recorder';
import { useTTSPlayback } from '../hooks/use-tts-playback';

type WizardStep =
  'choose-method' | 'upload' | 'prompts' | 'recording' | 'review' | 'processing' | 'done';

interface VoiceCloneWizardProps {
  agentId: string;
  agentName: string;
  onComplete: (voiceId: string, voiceName: string) => void;
  onCancel: () => void;
}

const GUIDED_PROMPTS = [
  {
    label: 'Read a sentence',
    text: 'The quick brown fox jumps over the lazy dog near the bank of the river on a warm summer afternoon.',
    instruction: 'Read this sentence clearly and naturally at your normal speaking pace.',
  },
  {
    label: 'Tell a story',
    text: 'Tell a short story about your favorite place to visit. Speak naturally, as if you were talking to a friend.',
    instruction: 'Speak freely for 15-30 seconds about any topic you enjoy.',
  },
  {
    label: 'Read with energy',
    text: "Great news! We just launched the most incredible product update. You're going to love the new features we've built for you.",
    instruction: 'Read this with enthusiasm and energy, like an excited announcement.',
  },
  {
    label: 'Count to twenty',
    text: 'Count from one to twenty at a steady, relaxed pace.',
    instruction: 'Count clearly and evenly. This helps capture your natural rhythm.',
  },
];

const LEVEL_BARS = 12;

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="flex items-end justify-center gap-0.5" style={{ height: 40 }}>
      {Array.from({ length: LEVEL_BARS }).map((_, i) => {
        const threshold = (i + 1) / LEVEL_BARS;
        const active = level >= threshold * 0.8;
        const height = 8 + ((i + 1) / LEVEL_BARS) * 32;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-75 ${
              active ? 'bg-brand' : 'bg-surface-300'
            }`}
            style={{ height: active ? height : 8 }}
          />
        );
      })}
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === current
              ? 'bg-brand w-4'
              : i < current
                ? 'bg-brand/40 w-1.5'
                : 'bg-surface-300 w-1.5'
          }`}
        />
      ))}
    </div>
  );
}

export function VoiceCloneWizard({
  agentId,
  agentName,
  onComplete,
  onCancel,
}: VoiceCloneWizardProps) {
  const [step, setStep] = useState<WizardStep>('choose-method');
  const [promptIndex, setPromptIndex] = useState(0);
  const [voiceName, setVoiceName] = useState(`${agentName} Clone`);
  const [error, setError] = useState<string | null>(null);
  const [promptPlaying, setPromptPlaying] = useState(false);

  const recorder = useAudioRecorder();
  const tts = useTTSPlayback({ agentId, voiceId: '', params: {} });

  const currentPrompt = GUIDED_PROMPTS[promptIndex];
  const totalDuration = recorder.clips.reduce((sum, c) => sum + c.duration, 0);

  const handleStartRecordingStep = useCallback(() => {
    setStep('prompts');
    setPromptIndex(0);
  }, []);

  const handleBeginRecording = useCallback(() => {
    setStep('recording');
    recorder.startRecording();
  }, [recorder]);

  const handleStopRecording = useCallback(() => {
    recorder.stopRecording();
    // Move to next prompt or review
    if (promptIndex < GUIDED_PROMPTS.length - 1) {
      setPromptIndex((prev) => prev + 1);
      setStep('prompts');
    } else {
      setStep('review');
    }
  }, [recorder, promptIndex]);

  const handleSubmit = useCallback(async () => {
    if (recorder.clips.length === 0) return;
    setStep('processing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('name', voiceName);
      formData.append('description', `Custom voice clone for ${agentName}`);

      for (const clip of recorder.clips) {
        formData.append('files', clip.blob, 'recording.webm');
      }

      const res = await fetch(`/api/agents/${agentId}/voice/clone`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Clone failed' }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const result = await res.json();
      setStep('done');

      // Brief pause then complete
      setTimeout(() => onComplete(result.voice_id, result.name), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed');
      setStep('review');
    }
  }, [recorder.clips, voiceName, agentId, agentName, onComplete]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-foreground-lighter hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Volume2 className="text-brand h-4 w-4" />
        <h2 className="text-foreground text-sm font-semibold">Add Custom Voice</h2>
      </div>

      {/* Choose method */}
      {step === 'choose-method' && (
        <div className="space-y-3">
          <p className="text-foreground-lighter text-xs">
            Create a custom voice clone for {agentName}.
          </p>

          <button
            type="button"
            onClick={handleStartRecordingStep}
            className="border-border bg-surface-100 hover:bg-surface-200 flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors"
          >
            <div className="bg-brand/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Mic className="text-brand h-5 w-5" />
            </div>
            <div>
              <span className="text-foreground text-sm font-medium">Record Voice</span>
              <p className="text-foreground-lighter text-xs">
                Guided recording flow with 4 prompts (~1 min total)
              </p>
            </div>
          </button>

          <button
            type="button"
            disabled
            className="border-border bg-surface-100 flex w-full cursor-not-allowed items-center gap-3 rounded-lg border p-4 text-left opacity-50"
          >
            <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Upload className="text-foreground-lighter h-5 w-5" />
            </div>
            <div className="flex items-center gap-2">
              <div>
                <span className="text-foreground text-sm font-medium">Upload Audio</span>
                <p className="text-foreground-lighter text-xs">Upload audio samples for cloning</p>
              </div>
              <span className="bg-surface-300 text-foreground-lighter rounded-full px-2 py-0.5 text-[10px] font-medium">
                Coming soon
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Upload placeholder */}
      {step === 'upload' && (
        <div className="border-border bg-surface-100 rounded-lg border p-8 text-center">
          <Upload className="text-foreground-lighter mx-auto h-8 w-8" />
          <p className="text-foreground-lighter mt-2 text-sm">Coming soon</p>
        </div>
      )}

      {/* Guided prompts - show prompt before recording */}
      {step === 'prompts' && currentPrompt && (
        <div className="space-y-4">
          <StepIndicator current={promptIndex} total={GUIDED_PROMPTS.length} />

          <div className="border-border bg-surface-100 space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="text-brand text-xs font-semibold">
                Prompt {promptIndex + 1} of {GUIDED_PROMPTS.length}
              </span>
              <span className="text-foreground-lighter text-xs">— {currentPrompt.label}</span>
            </div>

            <p className="text-foreground text-sm leading-relaxed">{currentPrompt.text}</p>

            <p className="text-foreground-lighter text-xs italic">{currentPrompt.instruction}</p>
          </div>

          <div className="flex justify-center">
            <Button onClick={handleBeginRecording} className="gap-2">
              <Mic className="h-4 w-4" />
              Start Recording
            </Button>
          </div>
        </div>
      )}

      {/* Active recording */}
      {step === 'recording' && (
        <div className="space-y-4">
          <StepIndicator current={promptIndex} total={GUIDED_PROMPTS.length} />

          <div className="flex flex-col items-center gap-4 py-4">
            <LevelMeter level={recorder.audioLevel} />

            <div className="text-brand font-mono text-lg font-[600] tabular-nums">
              {Math.floor(recorder.currentDuration)}s
            </div>

            <Button
              variant="outline"
              onClick={handleStopRecording}
              className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-2"
            >
              <MicOff className="h-4 w-4" />
              Stop Recording
            </Button>
          </div>
        </div>
      )}

      {/* Review recordings */}
      {step === 'review' && (
        <div className="space-y-4">
          <div>
            <label className="text-foreground mb-1.5 block text-xs font-medium">Voice name</label>
            <input
              type="text"
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              className="border-border bg-surface-200 text-foreground focus:border-brand/50 focus:ring-brand/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-foreground-light text-xs font-medium">
              Recordings ({recorder.clips.length}) — {Math.round(totalDuration)}s total
            </label>

            {recorder.clips.map((clip, i) => (
              <ClipRow key={i} clip={clip} index={i} onRemove={recorder.removeClip} />
            ))}

            {totalDuration < 30 && (
              <p className="text-warning text-xs">
                Minimum 30s of audio recommended. Record more prompts for better results.
              </p>
            )}
          </div>

          {error && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setPromptIndex(
                  recorder.clips.length < GUIDED_PROMPTS.length ? recorder.clips.length : 0,
                );
                setStep('prompts');
              }}
            >
              Record More
            </Button>
            <Button
              size="md"
              onClick={handleSubmit}
              disabled={recorder.clips.length === 0 || !voiceName.trim()}
              className="gap-1.5"
            >
              Clone Voice
            </Button>
          </div>
        </div>
      )}

      {/* Processing */}
      {step === 'processing' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="text-brand h-8 w-8 animate-spin" />
          <p className="text-foreground text-sm font-medium">Cloning voice…</p>
          <p className="text-foreground-lighter text-xs">
            Sending {recorder.clips.length} recording(s) for voice cloning
          </p>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="bg-brand/10 flex h-12 w-12 items-center justify-center rounded-full">
            <Check className="text-brand h-6 w-6" />
          </div>
          <p className="text-foreground text-sm font-medium">Voice cloned successfully!</p>
          <p className="text-foreground-lighter text-xs">
            {voiceName} is now available for {agentName}
          </p>
        </div>
      )}
    </div>
  );
}

// Clip playback row
function ClipRow({
  clip,
  index,
  onRemove,
}: {
  clip: RecordedClip;
  index: number;
  onRemove: (i: number) => void;
}) {
  const [playing, setPlaying] = useState(false);

  const handlePlay = () => {
    if (playing) return;
    const audio = new Audio(clip.url);
    audio.onended = () => setPlaying(false);
    audio.play();
    setPlaying(true);
  };

  return (
    <div className="border-border bg-surface-100 flex items-center gap-2 rounded-lg border px-3 py-2">
      <button
        type="button"
        onClick={handlePlay}
        className="text-foreground-lighter hover:text-brand transition-colors"
      >
        {playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <span className="text-foreground flex-1 text-xs font-medium">Clip {index + 1}</span>
      <span className="text-foreground-lighter font-mono text-xs tabular-nums">
        {Math.round(clip.duration)}s
      </span>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="text-foreground-lighter hover:text-destructive transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
