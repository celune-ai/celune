'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, Play, Square, Save, Check, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { fetchJson } from '@/lib/fetch-json';
import type {
  VoiceSettings,
  VoiceParams,
  ElevenLabsModel,
  AudioOutputFormat,
  TextNormalization,
  ProviderVoice,
  VoiceProviderInfo,
} from '@repo/types';
import { DROID_SYSTEM_PROMPT, DROID_VOICE_PARAMS } from '@/lib/droid-persona';

const DEFAULT_SILENCE_THRESHOLD_MS = 1500;

interface VoiceConfigPanelProps {
  agentId: string;
  agentName: string;
  onSettingsChange?: (settings: VoiceSettings) => void;
}

const MODEL_OPTIONS: { value: ElevenLabsModel; label: string }[] = [
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5' },
  { value: 'eleven_v3', label: 'v3 (Latest — audio tags)' },
];

const VOICE_PRESETS = [
  {
    id: 'natural',
    label: 'Natural',
    params: {
      stability: 0.4,
      similarity_boost: 0.75,
      style: 0.04,
      speed: 0.95,
      speaker_boost: true,
    },
  },
  {
    id: 'expressive',
    label: 'Expressive',
    params: { stability: 0.3, similarity_boost: 0.8, style: 0.08, speed: 1.0, speaker_boost: true },
  },
  {
    id: 'stable',
    label: 'Stable',
    params: {
      stability: 0.7,
      similarity_boost: 0.85,
      style: 0.01,
      speed: 1.0,
      speaker_boost: false,
    },
  },
] as const;

const FORMAT_OPTIONS: { value: AudioOutputFormat; label: string }[] = [
  { value: 'mp3_44100_128', label: 'MP3' },
  { value: 'pcm_16000', label: 'PCM' },
  { value: 'ogg_opus', label: 'OGG' },
];

function VoiceDropdown({
  voices,
  selectedVoiceId,
  search,
  onSearchChange,
  onSelect,
}: {
  voices: ProviderVoice[];
  selectedVoiceId: string;
  search: string;
  onSearchChange: (v: string) => void;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative space-y-1.5" ref={containerRef}>
      <label className="text-foreground-light text-xs font-medium">Select Voice</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="border-border bg-surface-200 text-foreground flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm"
      >
        <span className={selectedVoice ? 'text-foreground' : 'text-foreground-lighter'}>
          {selectedVoice?.name ?? 'Choose a voice…'}
        </span>
        <ChevronDown
          className={`text-foreground-lighter h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-border bg-surface-100 absolute right-0 left-0 z-20 rounded-lg border shadow-xl">
          <div className="border-border border-b px-3 py-2">
            <input
              type="text"
              placeholder="Search voices…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-brand/50 focus:ring-brand/30 w-full rounded border px-2.5 py-1.5 text-sm focus:ring-1 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {voices.map((voice) => {
              const isSelected = voice.voice_id === selectedVoiceId;
              const labels = Object.values(voice.labels).filter(Boolean);
              return (
                <button
                  key={voice.voice_id}
                  type="button"
                  onClick={() => {
                    onSelect(voice.voice_id);
                    setOpen(false);
                  }}
                  className={`border-border flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 ${
                    isSelected ? 'bg-brand/10' : 'hover:bg-surface-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium ${isSelected ? 'text-brand' : 'text-foreground'}`}
                      >
                        {voice.name}
                      </span>
                      {voice.category === 'cloned' && (
                        <span className="bg-brand/10 text-brand border-brand/20 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
                          Cloned
                        </span>
                      )}
                      {isSelected && <Check className="text-brand h-3 w-3 shrink-0" />}
                    </div>
                    {labels.length > 0 && (
                      <p className="text-foreground-lighter mt-0.5 truncate text-xs">
                        {labels.join(' · ')}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            {voices.length === 0 && (
              <p className="text-foreground-lighter px-3 py-4 text-center text-xs">
                No voices match your search.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function VoiceConfigPanel({ agentId, agentName, onSettingsChange }: VoiceConfigPanelProps) {
  const [voices, setVoices] = useState<ProviderVoice[]>([]);
  const [providers, setProviders] = useState<VoiceProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('elevenlabs');
  const [current, setCurrent] = useState<VoiceSettings | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [params, setParams] = useState<VoiceParams>({
    stability: 0.4,
    similarity_boost: 0.75,
    style: 0.04,
    speaker_boost: true,
    speed: 0.95,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [silenceThresholdMs, setSilenceThresholdMs] = useState(DEFAULT_SILENCE_THRESHOLD_MS);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load voices and current settings
  useEffect(() => {
    fetchJson<{
      voices: ProviderVoice[];
      current: VoiceSettings | null;
      providers?: VoiceProviderInfo[];
    }>(`/api/agents/${agentId}/voice`)
      .then((data) => {
        if (data && !('error' in data)) {
          setVoices(data.voices ?? []);
          if (data.providers) setProviders(data.providers);
          if (data.current?.voice_id) {
            setCurrent(data.current);
            setSelectedVoiceId(data.current.voice_id);
            setSelectedProvider(data.current.provider ?? 'elevenlabs');
            setParams(data.current.params);
            if (data.current.system_prompt) setSystemPrompt(data.current.system_prompt);
            if (data.current.silence_threshold_ms)
              setSilenceThresholdMs(data.current.silence_threshold_ms);
            // Auto-expand advanced if advanced params are set
            if (
              data.current.params.speed !== undefined ||
              data.current.params.speaker_boost !== undefined ||
              data.current.params.model_id !== undefined
            ) {
              setShowAdvanced(true);
            }
          }
        }
      })
      .catch(() => {
        /* Handled by loading state — panel shows empty defaults */
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);
  const currentProviderInfo = providers.find((p) => p.name === selectedProvider);
  const capabilities = currentProviderInfo?.capabilities;

  const handleProviderChange = async (newProvider: string) => {
    setSelectedProvider(newProvider);
    setSelectedVoiceId('');
    setDirty(true);
    // Fetch voices for the new provider
    try {
      // Temporarily save provider to fetch its voices
      const data = await fetchJson<{ voices: ProviderVoice[] }>(
        `/api/agents/${agentId}/voice?provider=${newProvider}`,
      );
      if (data && !('error' in data)) {
        setVoices(data.voices ?? []);
      }
    } catch {
      // Keep existing voices
    }
  };

  const applyPreset = (preset: (typeof VOICE_PRESETS)[number]) => {
    setParams((prev) => ({ ...prev, ...preset.params }));
    setDirty(true);
  };

  const isActivePreset = (preset: (typeof VOICE_PRESETS)[number]) =>
    preset.params.stability === params.stability &&
    preset.params.similarity_boost === params.similarity_boost &&
    preset.params.style === params.style &&
    preset.params.speed === (params.speed ?? 1.0) &&
    preset.params.speaker_boost === (params.speaker_boost ?? false);

  const handleVoiceSelect = (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    setDirty(true);
  };

  const handleParamChange = (key: keyof VoiceParams, value: number | boolean | string) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!selectedVoice || saving) return;
    setSaving(true);
    try {
      await fetch(`/api/agents/${agentId}/voice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider as 'elevenlabs' | 'openai',
          voice_id: selectedVoice.voice_id,
          voice_name: selectedVoice.name,
          params,
          ...(systemPrompt && { system_prompt: systemPrompt }),
          silence_threshold_ms: silenceThresholdMs,
        }),
      });
      const newSettings: VoiceSettings = {
        provider: selectedProvider as 'elevenlabs' | 'openai',
        voice_id: selectedVoice.voice_id,
        voice_name: selectedVoice.name,
        params: { ...params },
        ...(systemPrompt && { system_prompt: systemPrompt }),
        silence_threshold_ms: silenceThresholdMs,
      };
      setCurrent(newSettings);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSettingsChange?.(newSettings);
    } catch {
      // silent fail
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedVoiceId) return;

    // Stop current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playing) {
      setPlaying(false);
      return;
    }

    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/voice/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_id: selectedVoiceId,
          text: `Hi, I'm ${agentName}. This is how I sound with the current voice settings.`,
          params,
        }),
      });
      if (!res.ok) throw new Error('Preview failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      audio.play();
      setPlaying(true);
    } catch {
      // silent fail
    } finally {
      setPreviewLoading(false);
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const filteredVoices = voices.filter((v) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      Object.values(v.labels).some((l) => l.toLowerCase().includes(q))
    );
  });

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Volume2 className="text-brand h-4 w-4" />
          <h2 className="text-foreground text-sm font-semibold">Voice Identity</h2>
        </div>
        <div className="text-foreground-lighter flex items-center gap-2 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading voices…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="text-brand h-4 w-4" />
          <h2 className="text-foreground text-sm font-semibold">Voice Identity</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="md"
            variant="outline"
            onClick={handlePreview}
            disabled={!selectedVoiceId || previewLoading}
            className="gap-1.5"
          >
            {previewLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : playing ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {playing ? 'Stop' : 'Preview'}
          </Button>
          <Button
            size="md"
            onClick={handleSave}
            disabled={!dirty || saving || !selectedVoiceId}
            className="gap-1.5"
          >
            {saved ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save Voice
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Provider selector */}
      {providers.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-foreground-light text-xs font-medium">Voice Provider</label>
          <select
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="border-border bg-surface-200 text-foreground focus:border-brand/50 focus:ring-brand/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          >
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Current voice badge */}
      {current && (
        <div className="border-border bg-surface-100 inline-flex items-center gap-2 rounded-full border px-3 py-1.5">
          <span className="bg-brand h-1.5 w-1.5 rounded-full" />
          <span className="text-foreground text-xs font-medium">{current.voice_name}</span>
          <span className="text-foreground-lighter text-xs">
            via{' '}
            {providers.find((p) => p.name === current.provider)?.displayName ?? current.provider}
          </span>
        </div>
      )}

      {/* Voice selector — overlay dropdown */}
      <VoiceDropdown
        voices={filteredVoices}
        selectedVoiceId={selectedVoiceId}
        search={search}
        onSearchChange={setSearch}
        onSelect={handleVoiceSelect}
      />

      {/* Voice realism presets (ElevenLabs only) */}
      {selectedProvider === 'elevenlabs' && (
        <div className="space-y-2">
          <label className="text-foreground-light text-xs font-medium">Realism Preset</label>
          <div className="flex flex-wrap gap-2">
            {VOICE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActivePreset(preset)
                    ? 'bg-brand border-brand text-black'
                    : 'bg-surface-100 text-foreground-light border-border hover:border-brand/40'
                }`}
              >
                {isActivePreset(preset) && <Check className="h-3 w-3" />}
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Personality presets (ElevenLabs only) */}
      {selectedProvider === 'elevenlabs' && (
        <div className="space-y-2">
          <label className="text-foreground-light text-xs font-medium">Personality Preset</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setParams((prev) => ({ ...prev, ...DROID_VOICE_PARAMS }));
                setSystemPrompt(DROID_SYSTEM_PROMPT);
                setShowAdvanced(true);
                setDirty(true);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                systemPrompt === DROID_SYSTEM_PROMPT
                  ? 'bg-brand border-brand text-black'
                  : 'bg-surface-100 text-foreground-light border-border hover:border-brand/40'
              }`}
            >
              {systemPrompt === DROID_SYSTEM_PROMPT && <Check className="h-3 w-3" />}
              DROID Protocol
            </button>
            {systemPrompt && (
              <button
                type="button"
                onClick={() => {
                  setSystemPrompt('');
                  setDirty(true);
                }}
                className="text-foreground-lighter hover:text-foreground-light text-xs underline"
              >
                Clear persona
              </button>
            )}
          </div>
        </div>
      )}

      {/* Voice parameters */}
      <div className="space-y-3">
        <label className="text-foreground-light text-xs font-medium">Voice Parameters</label>
        {selectedProvider === 'elevenlabs' ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                { key: 'stability' as const, label: 'Stability', desc: 'Higher = more consistent' },
                {
                  key: 'similarity_boost' as const,
                  label: 'Clarity',
                  desc: 'Higher = closer to original',
                },
                { key: 'style' as const, label: 'Style', desc: 'Higher = more expressive' },
              ] as const
            ).map(({ key, label, desc }) => (
              <div key={key}>
                <div className="flex items-baseline justify-between">
                  <span className="text-foreground text-xs font-medium">{label}</span>
                  <span className="text-brand font-mono text-xs font-[600] tabular-nums">
                    {Math.round((params[key] as number) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((params[key] as number) * 100)}
                  onChange={(e) => handleParamChange(key, Number(e.target.value) / 100)}
                  className="agent-slider mt-1.5 w-full"
                  style={{ '--fill': `${(params[key] as number) * 100}%` } as React.CSSProperties}
                />
                <p className="text-foreground-lighter mt-1 text-xs">{desc}</p>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-foreground text-xs font-medium">Speed</span>
              <span className="text-brand font-mono text-xs font-[600] tabular-nums">
                {(params.speed ?? 1.0).toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={25}
              max={400}
              step={5}
              value={Math.round((params.speed ?? 1.0) * 100)}
              onChange={(e) => handleParamChange('speed', Number(e.target.value) / 100)}
              className="agent-slider mt-1.5 w-full"
              style={
                {
                  '--fill': `${(((params.speed ?? 1.0) - 0.25) / 3.75) * 100}%`,
                } as React.CSSProperties
              }
            />
            <p className="text-foreground-lighter mt-1 text-xs">0.25x to 4.0x playback speed</p>
          </div>
        )}
      </div>

      {/* Advanced settings (ElevenLabs only) */}
      {selectedProvider === 'elevenlabs' && (
        <>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-foreground-light hover:text-foreground flex items-center gap-1.5 text-xs font-medium transition-colors"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            />
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="border-border bg-surface-100 space-y-4 rounded-lg border p-4">
              {/* Speed slider */}
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-foreground text-xs font-medium">Speed</span>
                  <span className="text-brand font-mono text-xs font-[600] tabular-nums">
                    {(params.speed ?? 1.0).toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={200}
                  step={5}
                  value={Math.round((params.speed ?? 1.0) * 100)}
                  onChange={(e) => handleParamChange('speed', Number(e.target.value) / 100)}
                  className="agent-slider mt-1.5 w-full"
                  style={
                    {
                      '--fill': `${(((params.speed ?? 1.0) - 0.5) / 1.5) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <p className="text-foreground-lighter mt-1 text-xs">0.5x to 2.0x playback speed</p>
              </div>

              {/* Silence threshold */}
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-foreground text-xs font-medium">Silence threshold</span>
                  <span className="text-brand font-mono text-xs font-[600] tabular-nums">
                    {(silenceThresholdMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={500}
                  max={3000}
                  step={100}
                  value={silenceThresholdMs}
                  onChange={(e) => {
                    setSilenceThresholdMs(Number(e.target.value));
                    setDirty(true);
                  }}
                  className="agent-slider mt-1.5 w-full"
                  style={
                    {
                      '--fill': `${((silenceThresholdMs - 500) / 2500) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <p className="text-foreground-lighter mt-1 text-xs">
                  How long to wait after you stop speaking before sending
                </p>
              </div>

              {/* Speaker boost */}
              <label className="flex items-center justify-between">
                <div>
                  <span className="text-foreground text-xs font-medium">Speaker boost</span>
                  <p className="text-foreground-lighter text-xs">
                    Enhances speaker similarity at cost of stability
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={params.speaker_boost ?? false}
                  onClick={() =>
                    handleParamChange('speaker_boost', !(params.speaker_boost ?? false))
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    params.speaker_boost ? 'bg-brand' : 'bg-surface-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      params.speaker_boost ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>

              {/* Model selector */}
              <div>
                <span className="text-foreground mb-1.5 block text-xs font-medium">Model</span>
                <select
                  value={params.model_id ?? 'eleven_multilingual_v2'}
                  onChange={(e) => handleParamChange('model_id', e.target.value)}
                  className="border-border bg-surface-200 text-foreground focus:border-brand/50 focus:ring-brand/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                >
                  {MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Output format */}
              <div>
                <span className="text-foreground mb-1.5 block text-xs font-medium">
                  Output format
                </span>
                <select
                  value={params.output_format ?? 'mp3_44100_128'}
                  onChange={(e) => handleParamChange('output_format', e.target.value)}
                  className="border-border bg-surface-200 text-foreground focus:border-brand/50 focus:ring-brand/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Voice persona prompt */}
              <div>
                <span className="text-foreground mb-1.5 block text-xs font-medium">
                  Voice persona prompt
                </span>
                <p className="text-foreground-lighter mb-2 text-xs">
                  Optional system prompt injected when this voice is active in voice mode. Use for
                  character personas (e.g. DROID protocol).
                </p>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => {
                    setSystemPrompt(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="e.g. You are DROID, a dry-witted AI companion. Humor setting: 75%. Be dry, witty, and efficient..."
                  rows={4}
                  className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-brand/50 focus:ring-brand/30 w-full resize-y rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                />
              </div>

              {/* Text normalization */}
              <div>
                <span className="text-foreground mb-1.5 block text-xs font-medium">
                  Text normalization
                </span>
                <p className="text-foreground-lighter mb-2 text-xs">
                  Controls how the provider normalizes text before synthesis (numbers,
                  abbreviations, etc.)
                </p>
                <select
                  value={
                    params.text_normalization ??
                    (params.volume_normalization !== undefined
                      ? params.volume_normalization
                        ? 'on'
                        : 'off'
                      : 'auto')
                  }
                  onChange={(e) =>
                    handleParamChange('text_normalization', e.target.value as TextNormalization)
                  }
                  className="border-border bg-surface-200 text-foreground focus:border-brand/50 focus:ring-brand/30 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                >
                  <option value="auto">Auto (recommended)</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
