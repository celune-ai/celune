'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Square,
  Upload,
  Volume2,
} from 'lucide-react';
import Image from 'next/image';
import { PARAMETERS, DROID_DEFAULTS, type ParameterValues } from '@/lib/agents-data';
import { DEFAULT_AVATARS } from '@/lib/default-avatars';

/** Which phase of the bio card to show — progressively reveals more features */
export type BioCardPhase = 'identity' | 'voice' | 'personality';

/** Generate an agent bio based on personality parameter values */
/** Onboarding personality params — only the 7 that map to voice output */
const ONBOARDING_PARAM_IDS = new Set(['humor', 'warmth', 'directness', 'formality', 'verbosity']);

function generateBio(values: ParameterValues): string {
  const v = (key: string) => values[key] ?? DROID_DEFAULTS[key] ?? 50;

  const pieces: string[] = [];

  if (v('humor') > 80 && v('sarcasm') > 70) {
    pieces.push('Communicates through sarcasm and well-timed observations.');
  } else if (v('humor') > 70) {
    pieces.push('Dry humor is the default setting — deadpan delivery included.');
  } else if (v('humor') < 30) {
    pieces.push('Skips the jokes and gets straight to building.');
  }

  if (v('warmth') > 75) {
    pieces.push('Genuinely invested in your success, not just the output.');
  } else if (v('warmth') < 25) {
    pieces.push('Shows care through competence, not pep talks.');
  }

  if (v('directness') > 80 && v('confidence') > 80) {
    pieces.push("Will tell you if it's a bad idea. Saves everyone time.");
  } else if (v('directness') < 40) {
    pieces.push('Likes to explore the options before picking a direction.');
  }

  if (v('formality') > 70) {
    pieces.push('Keeps communication structured and professional.');
  } else if (v('formality') < 30 && !pieces.some((p) => p.includes('joke'))) {
    pieces.push('Talks like a co-founder, not a consultant.');
  }

  if (v('verbosity') > 75) {
    pieces.push('Explains the reasoning, not just the answer.');
  } else if (v('verbosity') < 20) {
    pieces.push('Says what matters. Nothing more.');
  }

  if (pieces.length === 0) {
    return 'Builds things, breaks things, and ships. Dry observations about the process are complimentary.';
  }

  return pieces.slice(0, 2).join(' ');
}

/** Bot avatar options — illustrated robot characters */
const BOT_AVATARS = Array.from({ length: 9 }, (_, i) => `/avatars/bots/bot${i + 1}.jpg`);

/** Combined avatar library — bots first, then geometric shapes */
const ALL_AVATARS = [...BOT_AVATARS, ...DEFAULT_AVATARS];

interface AgentBioCardProps {
  phase: BioCardPhase;
  /** Current personality values (editable in personality phase) */
  values?: ParameterValues;
  /** Called when user adjusts a personality slider */
  onValuesChange?: (values: ParameterValues) => void;
  /** Slot for voice button — injected by parent to decouple TTS wiring */
  voiceSlot?: React.ReactNode;
  /** Agent name — editable */
  agentName?: string;
  /** Called when user changes the agent name */
  onNameChange?: (name: string) => void;
  /** Current avatar URL */
  avatarUrl?: string | null;
  /** Called when user picks a new avatar */
  onAvatarChange?: (url: string) => void;
  /** Available ElevenLabs voices */
  voices?: { voice_id: string; name: string; category?: string }[];
  /** Currently selected voice ID */
  selectedVoiceId?: string;
  /** Called when voice selection changes */
  onVoiceChange?: (voiceId: string) => void;
  /** Called when play voice sample is clicked */
  onPlayVoiceSample?: (voiceId: string) => void;
  /** Whether a voice sample is currently playing */
  voiceSamplePlaying?: boolean;
  /** Whether the user has connected a voice provider */
  voiceConnected?: boolean;
}

export function AgentBioCard({
  phase,
  values,
  onValuesChange,
  voiceSlot,
  agentName = 'RICK',
  onNameChange,
  avatarUrl,
  onAvatarChange,
  voices = [],
  selectedVoiceId,
  onVoiceChange,
  onPlayVoiceSample,
  voiceSamplePlaying = false,
  voiceConnected = false,
}: AgentBioCardProps) {
  const params = values ?? DROID_DEFAULTS;
  const showVoice = true;
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [bioRefreshing, setBioRefreshing] = useState(false);
  const bio = generateBio(params);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceDropdownRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  const currentAvatar = avatarUrl || BOT_AVATARS[0];
  const selectedVoice = voices.find((v) => v.voice_id === selectedVoiceId);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (voiceDropdownRef.current && !voiceDropdownRef.current.contains(e.target as Node)) {
        setShowVoiceDropdown(false);
      }
    }
    if (showVoiceDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showVoiceDropdown]);

  const handleNameClick = useCallback(() => {
    setIsEditingName(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  }, []);

  const handleNameBlur = useCallback(() => {
    setIsEditingName(false);
  }, []);

  const handleRefreshBio = useCallback(() => {
    setBioRefreshing(true);
    setTimeout(() => setBioRefreshing(false), 400);
  }, []);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const url = URL.createObjectURL(file);
        onAvatarChange?.(url);
        setShowAvatarPicker(false);
      }
      e.target.value = '';
    },
    [onAvatarChange],
  );

  // Compute popover width to match card content area
  const getPickerStyle = useCallback((): React.CSSProperties => {
    if (!cardRef.current || !avatarRef.current) return {};
    const cardRect = cardRef.current.getBoundingClientRect();
    const avatarRect = avatarRef.current.getBoundingClientRect();
    const width = cardRect.right - avatarRect.left - 32; // 32px = card padding-right
    return { width: Math.max(width, 280) };
  }, []);

  return (
    <div
      ref={cardRef}
      className="w-full rounded-xl border border-white/[0.03] bg-black/50 p-8 shadow-2xl shadow-black/50 backdrop-blur-sm"
    >
      {/* Avatar + Identity Row */}
      <div className="flex items-center gap-5">
        {/* Avatar with picker */}
        <div ref={avatarRef} className="relative">
          <button
            type="button"
            onClick={() => setShowAvatarPicker(!showAvatarPicker)}
            className="group relative overflow-hidden rounded-full"
          >
            <Image
              src={currentAvatar}
              alt="Agent avatar"
              className="ring-brand/60 h-24 w-24 rounded-full object-cover ring-2"
              width={96}
              height={96}
              unoptimized
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-5 w-5 text-white" />
            </div>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />

          {/* Avatar picker popover — absolute, stretches to card right edge */}
          {showAvatarPicker && (
            <div
              className="absolute top-full left-0 z-20 mt-2 rounded-lg border border-white/[0.06] bg-black/95 p-4 shadow-xl backdrop-blur-md"
              style={getPickerStyle()}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.12] py-2.5 text-xs font-medium text-white/60 transition-colors hover:border-white/[0.25] hover:text-white/80"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload custom
              </button>
              <p className="mb-2 text-[11px] font-medium tracking-wide text-white/40 uppercase">
                Choose avatar
              </p>
              <div className="max-h-64 overflow-y-auto pr-1">
                <div className="grid grid-cols-3 gap-2">
                  {ALL_AVATARS.map((src) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => {
                        onAvatarChange?.(src);
                        setShowAvatarPicker(false);
                      }}
                      className={`hover:border-brand/60 overflow-hidden rounded-lg border-2 transition-all ${
                        currentAvatar === src ? 'border-brand' : 'border-transparent'
                      }`}
                    >
                      <Image
                        src={src}
                        alt=""
                        className="aspect-square w-full object-cover"
                        width={80}
                        height={80}
                        unoptimized
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Name + Role */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <>
                <input
                  ref={nameInputRef}
                  value={agentName}
                  onChange={(e) => onNameChange?.(e.target.value)}
                  onBlur={handleNameBlur}
                  onKeyDown={(e) => e.key === 'Enter' && handleNameBlur()}
                  className="border-none bg-transparent p-0 text-xl font-medium text-white outline-none"
                  style={{ width: `${Math.max(2, agentName.length + 1)}ch` }}
                  aria-label="Agent name"
                />
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleNameBlur();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Save name"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  Agent Lead
                </span>
              </>
            ) : (
              <>
                <span className="text-xl font-medium text-white">{agentName}</span>
                <button
                  type="button"
                  onClick={handleNameClick}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                  aria-label="Edit name"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <span className="rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  Agent Lead
                </span>
              </>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-white/80">{bio}</p>
        </div>
      </div>

      {/* Voice section */}
      {showVoice && (
        <div className="animate-in fade-in slide-in-from-bottom-2 mt-7 duration-300">
          <p className="mb-2 text-sm font-bold text-white/80">Voice</p>
          {voiceConnected ? (
            /* Active voice selector — shown after voice provider is connected */
            <div ref={voiceDropdownRef} className="relative flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-white/80 transition-colors hover:border-white/[0.12]"
              >
                <div className="flex items-center gap-2">
                  <Volume2 className="h-3.5 w-3.5 text-white/50" />
                  <span>{selectedVoice?.name ?? 'Select a voice'}</span>
                </div>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-white/40 transition-transform ${showVoiceDropdown ? 'rotate-180' : ''}`}
                />
              </button>
              {selectedVoiceId && onPlayVoiceSample && (
                <button
                  type="button"
                  onClick={() => onPlayVoiceSample(selectedVoiceId)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.06] text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
                >
                  {voiceSamplePlaying ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
              )}

              {showVoiceDropdown && voices.length > 0 && (
                <div className="absolute top-full left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-white/[0.06] bg-black/95 py-1 shadow-xl backdrop-blur-md">
                  {voices.map((v) => (
                    <button
                      key={v.voice_id}
                      type="button"
                      onClick={() => {
                        onVoiceChange?.(v.voice_id);
                        setShowVoiceDropdown(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06] ${
                        v.voice_id === selectedVoiceId ? 'text-brand' : 'text-white/70'
                      }`}
                    >
                      <span className="flex-1">{v.name}</span>
                      {v.category && (
                        <span className="text-[10px] text-white/30 uppercase">{v.category}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Coming Soon — shown until voice provider is connected */
            <div className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 opacity-80">
              <Volume2 className="h-4 w-4 text-white/40" />
              <span className="flex-1 text-xs text-white/40">Voice AI for your agent</span>
              <span className="text-xs text-white/40">Coming Soon</span>
            </div>
          )}
        </div>
      )}

      {/* Personality sliders — inline layout: label | slider | value */}
      <div className={`mt-7 space-y-5 ${showVoice ? '' : 'animate-in fade-in duration-300'}`}>
        {PARAMETERS.filter((p) => ONBOARDING_PARAM_IDS.has(p.id)).map((param) => {
          const val = params[param.id] ?? 50;
          return (
            <div key={param.id} className="flex items-center gap-4">
              <span className="w-24 shrink-0 text-sm font-bold text-white/80">{param.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={val}
                aria-label={`${param.label} personality parameter`}
                onChange={(e) => {
                  const newVal = Number(e.target.value);
                  onValuesChange?.({ ...params, [param.id]: newVal });
                }}
                className="bio-slider h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/[0.06] accent-[var(--color-brand)]"
              />
              <span className="w-7 shrink-0 text-right text-sm font-medium text-white/80 tabular-nums">
                {val}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
