'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Bot,
  Camera,
  Check,
  ChevronRight,
  Pause,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Mic,
  Square,
  Type,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@repo/ui/components/button';
import { Toggle } from '@repo/ui/components/toggle';
import { PageActionBar } from '@/components/page-action-bar';
import {
  AGENTS,
  PARAMETERS,
  PROFILES,
  DROID_DEFAULTS,
  resolveProfile,
  getAgent,
  getProfile,
  type ParameterValues,
  type AgentStatus,
} from '@/lib/agents-data';
import { fetchJson } from '@/lib/fetch-json';
import { usePlan } from '@/hooks/use-plan';
import { AGENT_AVATAR_MAP, DEFAULT_AVATARS, getNextAvatar } from '@/lib/default-avatars';
import { ParameterSlider } from './components/parameter-slider';
import { VoiceConfigPanel } from './components/voice-config-panel';
import { AgentSettingsPanel } from './components/agent-settings-panel';
import { ChatMessage } from './components/chat-message';
import { ThinkingIndicator } from './components/thinking-indicator';
import type { VoiceConversationState } from './components/voice-mode-controls';
import { useAgentChat } from './hooks/use-agent-chat';
import { useTTSPlayback } from './hooks/use-tts-playback';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { useMicLevel } from '@/hooks/use-mic-level';
import { toast } from 'sonner';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useWorkspace } from '@/providers/workspace-provider';
import { adminNav } from '@/lib/nav';
import type { VoiceSettings } from '@repo/types';

// ---------------------------------------------------------------------------
// Live status hook (same pattern as the team list page)
// ---------------------------------------------------------------------------

interface LiveStatus {
  status: string;
  last_heartbeat: string | null;
  current_task_id: string | null;
  model: string | null;
}

function useLiveStatus(agentName: string): LiveStatus | null {
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  useEffect(() => {
    const fetchStatus = () => {
      fetchJson<Record<string, LiveStatus>>('/api/agents/status')
        .then((data) => {
          if (data && typeof data === 'object' && !('error' in data)) {
            const key = agentName.toLowerCase();
            setLiveStatus(data[key] ?? null);
          }
        })
        .catch(() => {
          /* Non-blocking — status refreshes on next poll */
        });
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [agentName]);
  return liveStatus;
}

function mapLiveStatus(raw: string, lastHeartbeat: string | null): AgentStatus {
  switch (raw) {
    case 'online': {
      if (lastHeartbeat) {
        const age = Date.now() - new Date(lastHeartbeat).getTime();
        if (age > 60 * 60 * 1000) return 'idle';
      }
      return 'standby';
    }
    case 'working':
      return 'working';
    case 'idle':
      return 'idle';
    case 'offline':
      return 'unreachable';
    default:
      return 'unreachable';
  }
}

// ---------------------------------------------------------------------------
// Config readout
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Personality biography — generated from parameter values
// ---------------------------------------------------------------------------

/** Maps a 0–100 value to a descriptor band */
function band(val: number | undefined, low: string, mid: string, high: string): string {
  const v = val ?? 50;
  if (v <= 30) return low;
  if (v <= 70) return mid;
  return high;
}

function generateBio(name: string, p: ParameterValues, profile: string): string {
  const humor = band(
    p.humor,
    'rarely jokes',
    'has a dry sense of humor',
    'laces everything with deadpan wit',
  );
  const honesty = band(
    p.honesty,
    'delivers truth gently',
    'is straightforward but tactful',
    'holds nothing back',
  );
  const directness = band(
    p.directness,
    'provides thorough context before conclusions',
    'balances context with brevity',
    'cuts straight to the point',
  );
  const warmth = band(
    p.warmth,
    'shows care through competence, not words',
    'is supportive without being soft',
    'is genuinely encouraging and empathetic',
  );
  const confidence = band(
    p.confidence,
    'offers options and hedges carefully',
    'states positions with measured confidence',
    'asserts things as fact and defends them',
  );
  const formality = band(
    p.formality,
    'talks like a friend at a whiteboard',
    'keeps it professional but relaxed',
    'communicates with consultant-grade polish',
  );
  const verbosity = band(
    p.verbosity,
    'keeps responses lean, almost cryptic',
    'says what matters without excess',
    'explains things thoroughly',
  );
  const autonomy = band(
    p.autonomy,
    'checks in before every move',
    'balances initiative with input-seeking',
    'decides and informs after the fact',
  );
  const sarcasm = band(
    p.sarcasm,
    'keeps humor observational',
    'adds a light edge when the moment calls for it',
    'affectionately roasts everything in sight',
  );
  const selfAwareness = band(
    p.self_awareness,
    'stays in character without meta-commentary',
    'occasionally nods at the human-AI dynamic',
    'frequently makes meta-observations about being an AI',
  );

  const profileLabel = profile === 'custom' ? 'custom tuning' : `the "${profile}" profile`;

  return `${name} ${humor} and ${honesty}. They ${directness} and ${confidence}. In conversation, ${name} ${warmth} and ${formality}. They ${verbosity} while ${sarcasm}. On autonomy, ${name} ${autonomy}. ${name} ${selfAwareness}. Currently running on ${profileLabel}.`;
}

function AgentBio({
  name,
  params,
  profile,
  loading,
}: {
  name: string;
  params: ParameterValues;
  profile: string;
  loading: boolean;
}) {
  const bio = generateBio(name, params, profile);

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md backdrop-blur-[2px]">
          <div className="flex items-center gap-2">
            <span className="bg-brand h-1.5 w-1.5 animate-pulse rounded-full" />
            <span className="text-foreground-lighter text-xs">Updating personality…</span>
          </div>
        </div>
      )}
      <p
        className={`text-foreground-light text-xs leading-relaxed transition-opacity duration-300 ${
          loading ? 'opacity-40' : 'opacity-100'
        }`}
      >
        {bio}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentSettingsPage() {
  const params = useParams();
  const agentId = params.id as string;
  const hardcodedAgent = getAgent(agentId);
  const [dbAgent, setDbAgent] = useState<ReturnType<typeof getAgent> | null>(null);
  const agent = hardcodedAgent ?? dbAgent;
  const router = useRouter();
  const { workspaceHref } = useWorkspaceHref();
  const { activeWorkspace } = useWorkspace();
  const { hasFeature } = usePlan();
  const voiceChatEnabled = hasFeature('voice_chat');

  // Live status (polls /api/agents/status every 5 s)
  const liveStatus = useLiveStatus(agent?.name ?? '');
  const resolvedStatus: AgentStatus = liveStatus
    ? mapLiveStatus(liveStatus.status, liveStatus.last_heartbeat)
    : (agent?.status ?? 'unreachable');

  // Config state
  const [values, setValues] = useState<ParameterValues>({});
  const [activeProfile, setActiveProfile] = useState('default');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const bioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agent avatar state
  const [agentAvatar, setAgentAvatar] = useState<string>(
    AGENT_AVATAR_MAP[agentId] ?? DEFAULT_AVATARS[0],
  );
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // DB-backed agent config (for workspace-scoped agents)
  const workspaceId = activeWorkspace?.id;
  const [dbAgentConfig, setDbAgentConfig] = useState<Record<string, string> | null>(null);
  const [dbFetchDone, setDbFetchDone] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    fetchJson<Record<string, unknown>>(`/api/agents/configs?workspace_id=${workspaceId}`)
      .then((data) => {
        if (Array.isArray(data)) {
          const match = data.find((a: Record<string, unknown>) => a.agent_id === agentId);
          if (match) {
            setDbAgentConfig(match as Record<string, string>);
            if (!hardcodedAgent) {
              setDbAgent({
                id: (match as Record<string, string>).agent_id,
                name:
                  (match as Record<string, string>).display_name ||
                  (match as Record<string, string>).agent_id?.toUpperCase() ||
                  'Agent',
                role: (match as Record<string, string>).role || 'Agent',
                type: ((match as Record<string, string>).agent_type || 'ai') as 'ai' | 'human',
                status: 'standby' as AgentStatus,
                model: (match as Record<string, string>).model || undefined,
                description: (match as Record<string, string>).description || '',
                parameters: {},
                activeProfile: 'default',
                depth: 1,
                permissions: [],
              });
            }
          }
        }
      })
      .catch(() => {
        /* Non-critical — agent page works without DB config */
      })
      .finally(() => {
        setDbFetchDone(true);
      });
  }, [workspaceId, agentId]);

  // Resolved display name: prefer DB config (user's actual agent name) over hardcoded fallback
  const agentDisplayName = dbAgentConfig?.display_name || agent?.name || 'Agent';

  // Voice mode state — default to text chat (voice gated by feature flag)
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [conversationState, setConversationState] = useState<VoiceConversationState>('idle');
  const voiceActiveRef = useRef(false);

  // Load voice settings for TTS playback
  useEffect(() => {
    fetchJson<{ current: VoiceSettings | null }>(`/api/agents/${agentId}/voice`)
      .then((data) => {
        if (data && !('error' in data) && data.current) {
          setVoiceSettings(data.current);
        }
      })
      .catch(() => {
        /* Non-critical — voice is optional, chat still works */
      });
  }, [agentId]);

  // Sentence queue for streaming TTS — play sentences as they arrive
  const sentenceQueueRef = useRef<string[]>([]);
  // Ref-based flag to avoid race conditions (state is stale between streaming chunks)
  const ttsActiveRef = useRef(false);
  // Track whether any sentence was emitted during this response (for fallback)
  const sentencesEmittedRef = useRef(false);
  const heardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After TTS finishes speaking a chunk, play next queued sentence or restart listening
  const handlePlaybackEnd = useCallback(() => {
    if (sentenceQueueRef.current.length > 0) {
      const next = sentenceQueueRef.current.shift()!;
      ttsRef.current?.playText(next);
    } else {
      ttsActiveRef.current = false;
      if (voiceActiveRef.current) {
        setConversationState('listening');
        // 600ms delay prevents the mic from picking up residual speaker audio
        // (the old 150ms was too short — speakers are still "ringing")
        setTimeout(() => {
          if (voiceActiveRef.current) {
            speechRef.current?.start();
          }
        }, 600);
      } else {
        setConversationState('idle');
      }
    }
  }, []);

  // TTS playback
  const tts = useTTSPlayback({
    agentId,
    voiceId: voiceSettings?.voice_id ?? '',
    params: voiceSettings?.params,
    onPlaybackEnd: handlePlaybackEnd,
  });
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

  // Called per-sentence during streaming — starts TTS immediately on first sentence
  const handleStreamingSentence = useCallback(
    (sentence: string) => {
      if (!voiceActiveRef.current || !voiceSettings?.voice_id) return;
      sentencesEmittedRef.current = true;
      if (!ttsActiveRef.current) {
        // Nothing playing — start immediately
        ttsActiveRef.current = true;
        setConversationState('speaking');
        ttsRef.current.playText(sentence);
      } else {
        // Already playing or loading — queue for later
        sentenceQueueRef.current.push(sentence);
      }
    },
    [voiceSettings?.voice_id],
  );

  // Fallback: if no sentences were emitted during streaming, play the full text
  const handleAssistantComplete = useCallback(
    (text: string) => {
      if (!voiceActiveRef.current || !voiceSettings?.voice_id) return;
      if (!sentencesEmittedRef.current && text.trim()) {
        ttsActiveRef.current = true;
        setConversationState('speaking');
        ttsRef.current.playText(text);
      }
    },
    [voiceSettings?.voice_id],
  );

  // Navigation handler — validates path against known routes before navigating
  const handleAgentNavigate = useCallback(
    (path: string) => {
      // Respect workspace auto_open_urls setting
      const meta = activeWorkspace?.metadata as Record<string, unknown> | null | undefined;
      if (meta && 'auto_open_urls' in meta && meta.auto_open_urls === false) {
        return;
      }
      const validPaths = adminNav.map((n) => n.href);
      if (!validPaths.some((p) => path === p || path.startsWith(p + '/'))) {
        return; // silently ignore invalid paths
      }
      const navItem = adminNav.find((n) => path === n.href || path.startsWith(n.href + '/'));
      const label = navItem?.label ?? path;
      toast(`${agent?.name ?? 'Agent'} is navigating to ${label}...`);
      router.push(workspaceHref(path));
    },
    [router, workspaceHref, activeWorkspace, agent?.name],
  );

  // Chat hook
  const {
    messages,
    input,
    setInput,
    streaming,
    chatError,
    sendMessage,
    handleKeyDown,
    clearChat,
    bottomRef,
    textareaRef,
  } = useAgentChat({
    agentId,
    workspaceId: activeWorkspace?.id,
    values,
    voiceMode,
    onAssistantComplete: handleAssistantComplete,
    onStreamingSentence: handleStreamingSentence,
    onNavigate: handleAgentNavigate,
  });

  // Track the latest assistant message index for word highlighting
  useEffect(() => {
    if (tts.isSpeaking && voiceActiveRef.current) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].content) {
          setTtsMessageIndex(i);
          break;
        }
      }
    }
    // Don't clear ttsMessageIndex when speaking stops — words should stay colored
    // It resets when a new conversation turn starts (via resetHighlight)
  }, [tts.isSpeaking, messages]);

  // When streaming starts, switch to processing state
  useEffect(() => {
    if (streaming && voiceActiveRef.current) {
      setConversationState('processing');
    }
  }, [streaming]);

  // Track which message index is being auto-played with highlighting
  const [ttsMessageIndex, setTtsMessageIndex] = useState<number | null>(null);

  // When speech recognition produces a final transcript, auto-send it
  const handleFinalTranscript = useCallback(
    (text: string) => {
      if (!voiceActiveRef.current) return;
      // Reset sentence tracking and highlight state for the new response
      sentencesEmittedRef.current = false;
      sentenceQueueRef.current = [];
      ttsActiveRef.current = false;
      ttsRef.current.stopPlayback();
      ttsRef.current.resetHighlight();
      setTtsMessageIndex(null);
      // Clear transcript immediately so stale text doesn't linger
      speechRef.current?.stop();
      speechRef.current?.resetTranscript();
      // Brief "Heard you…" state before processing — gives visual acknowledgement
      setConversationState('heard');
      if (heardTimerRef.current) clearTimeout(heardTimerRef.current);
      heardTimerRef.current = setTimeout(() => {
        heardTimerRef.current = null;
        if (voiceActiveRef.current) {
          setConversationState('processing');
        }
      }, 400);
      sendMessage(text);
    },
    [sendMessage],
  );

  // Speech recognition with auto-send callback
  const speech = useSpeechRecognition({
    onFinalTranscript: handleFinalTranscript,
    silenceThreshold: voiceSettings?.silence_threshold_ms,
  });
  // Store ref so callbacks can call start()
  const speechRef = useRef(speech);
  speechRef.current = speech;

  // Real-time mic level for audio visualizer
  const micLevels = useMicLevel(voiceMode && conversationState === 'listening');

  // Stop speech recognition during TTS playback and processing to prevent
  // the agent's audio from being picked up as user input (feedback loop)
  useEffect(() => {
    if (conversationState === 'speaking' || conversationState === 'processing') {
      speech.stop();
    }
  }, [conversationState, speech]);

  // Auto-restart recognition if it silently dies during voice mode
  // (Web Speech API stops after silence timeout) — but NOT on permission errors
  useEffect(() => {
    if (
      voiceActiveRef.current &&
      conversationState === 'listening' &&
      !speech.isListening &&
      !speech.error
    ) {
      const timer = setTimeout(() => {
        if (voiceActiveRef.current && conversationState === 'listening' && !speech.error) {
          speech.start();
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [speech.isListening, conversationState, speech, speech.error]);

  // Toggle voice conversation on/off
  const handleVoiceToggle = useCallback(() => {
    if (voiceActiveRef.current) {
      // Turn off
      voiceActiveRef.current = false;
      ttsActiveRef.current = false;
      sentencesEmittedRef.current = false;
      if (heardTimerRef.current) {
        clearTimeout(heardTimerRef.current);
        heardTimerRef.current = null;
      }
      speech.stop();
      speech.resetTranscript();
      tts.stopPlayback();
      tts.resetHighlight();
      sentenceQueueRef.current = [];
      setConversationState('idle');
    } else {
      // Turn on — start listening
      voiceActiveRef.current = true;
      ttsActiveRef.current = false;
      sentencesEmittedRef.current = false;
      sentenceQueueRef.current = [];
      speech.resetTranscript();
      setConversationState('listening');
      speech.start();
    }
  }, [speech, tts]);

  // Interrupt TTS during speaking — stops audio, lets user speak immediately
  const handleInterrupt = useCallback(() => {
    // Stop all TTS playback and mark words as read
    tts.skipToEnd();
    sentenceQueueRef.current = [];
    ttsActiveRef.current = false;
    // Short delay then start listening
    setConversationState('listening');
    setTimeout(() => {
      if (voiceActiveRef.current) {
        speechRef.current?.start();
      }
    }, 300);
  }, [tts]);

  // Load saved config from Supabase (falls back to static defaults)
  useEffect(() => {
    if (!agent) return;
    fetchJson<{ error?: string; parameters?: ParameterValues; active_profile?: string }>(
      `/api/agents/${agentId}/config`,
    )
      .then((data) => {
        if (data && !data.error) {
          setValues(data.parameters ?? { ...agent.parameters });
          setActiveProfile(data.active_profile ?? agent.activeProfile);
        } else {
          setValues({ ...agent.parameters });
          setActiveProfile(agent.activeProfile);
        }
      })
      .catch(() => {
        setValues({ ...agent.parameters });
        setActiveProfile(agent.activeProfile);
      })
      .finally(() => setConfigLoaded(true));
  }, [agentId, agent]);

  const handleSliderChange = useCallback((id: string, value: number) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setActiveProfile('custom');
    setDirty(true);
    // Show bio loading state, debounced
    setBioLoading(true);
    if (bioTimerRef.current) clearTimeout(bioTimerRef.current);
    bioTimerRef.current = setTimeout(() => setBioLoading(false), 500);
  }, []);

  const handleProfileSelect = useCallback((profileId: string) => {
    const profile = getProfile(profileId);
    if (!profile) return;
    setValues(resolveProfile(profile));
    setActiveProfile(profileId);
    setDirty(true);
    setBioLoading(true);
    if (bioTimerRef.current) clearTimeout(bioTimerRef.current);
    bioTimerRef.current = setTimeout(() => setBioLoading(false), 500);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: values, active_profile: activeProfile }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Silently fail — don't block the user, just don't show "Saved"
    } finally {
      setSaving(false);
    }
  }, [agentId, values, activeProfile, saving]);

  // Not found / human agent guards — wait for DB fetch before showing not-found
  if (!agent && !dbFetchDone) {
    return null;
  }
  if (!agent) {
    return (
      <div className="flex min-h-full flex-col">
        <PageActionBar>
          <nav className="flex items-center gap-2 text-xl">
            <Link
              href={workspaceHref('/agents')}
              className="text-foreground-lighter hover:text-foreground font-medium transition-colors"
            >
              Team
            </Link>
            <ChevronRight className="text-foreground-lighter h-4 w-4" />
            <span className="text-foreground font-medium">Agent</span>
          </nav>
        </PageActionBar>
        <div className="p-6">
          <p className="text-foreground-lighter text-sm">Agent not found.</p>
        </div>
      </div>
    );
  }

  if (agent.type === 'human') {
    const message = "Human agents don't have configurable parameters.";
    return (
      <div className="flex min-h-full flex-col">
        <PageActionBar>
          <nav className="flex items-center gap-2 text-xl">
            <Link
              href={workspaceHref('/agents')}
              className="text-foreground-lighter hover:text-foreground font-medium transition-colors"
            >
              Team
            </Link>
            <ChevronRight className="text-foreground-lighter h-4 w-4" />
            <span className="text-foreground font-medium">{agent?.name ?? 'Agent'}</span>
          </nav>
        </PageActionBar>
        <div className="p-6">
          <p className="text-foreground-lighter text-sm">{message}</p>
        </div>
      </div>
    );
  }

  if (!configLoaded) {
    return (
      <div className="flex min-h-full flex-col">
        <PageActionBar>
          <nav className="flex items-center gap-2 text-xl">
            <Link
              href={workspaceHref('/agents')}
              className="text-foreground-lighter hover:text-foreground font-medium transition-colors"
            >
              Team
            </Link>
            <ChevronRight className="text-foreground-lighter h-4 w-4" />
            <span className="text-foreground font-medium">{agent?.name ?? 'Agent'}</span>
          </nav>
        </PageActionBar>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-foreground-lighter flex items-center gap-2 text-sm">
            <span className="bg-foreground-lighter h-3 w-3 animate-pulse rounded-full" />
            Loading config…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Action bar */}
      <PageActionBar>
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            href={workspaceHref('/agents')}
            className="text-foreground-lighter hover:text-foreground transition-colors"
          >
            Team
          </Link>
          <ChevronRight className="text-foreground-lighter h-3.5 w-3.5" />
          <span className="text-foreground font-medium">{agent?.name ?? 'Agent'}</span>
        </nav>
        <Button
          size="md"
          onClick={handleSave}
          disabled={(!dirty && !saved) || saving}
          className="gap-1.5"
        >
          {saved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Saved
            </>
          ) : saving ? (
            <>
              <Save className="h-3.5 w-3.5 animate-pulse" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </>
          )}
        </Button>
      </PageActionBar>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: configuration */}
        <div className="border-border flex-1 overflow-y-auto border-r">
          <div className="space-y-10 px-6 py-6">
            {/* Agent header with config metadata */}
            <div className="border-border bg-surface-100 flex items-stretch rounded-lg border">
              {/* Left: identity */}
              <div className="flex items-start gap-4 p-4">
                <div className="group/avatar relative">
                  <div className="bg-surface-200 border-border flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                    <Image
                      src={agentAvatar}
                      alt={agent.name}
                      className="h-full w-full object-cover"
                      width={48}
                      height={48}
                      unoptimized
                    />
                  </div>
                  {/* Refresh — cycle through defaults */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = getNextAvatar(agentAvatar, false);
                      setAgentAvatar(next);
                      setDirty(true);
                    }}
                    className="border-border bg-surface-75 hover:bg-surface-100 absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/avatar:opacity-100"
                    title="Cycle avatar"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                  </button>
                  {/* Upload custom image */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      avatarInputRef.current?.click();
                    }}
                    className="border-border bg-surface-75 hover:bg-surface-100 absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border opacity-0 transition-opacity group-hover/avatar:opacity-100"
                    title="Upload avatar"
                  >
                    <Camera className="h-2.5 w-2.5" />
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        setAgentAvatar(url);
                        setDirty(true);
                      }
                      e.target.value = '';
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h1 className="text-foreground text-lg font-semibold">{agent.name}</h1>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                        resolvedStatus === 'working'
                          ? 'bg-brand/10 text-brand border-brand/20'
                          : resolvedStatus === 'standby'
                            ? 'bg-warning/10 text-warning border-warning/20'
                            : resolvedStatus === 'idle'
                              ? 'bg-surface-300 text-foreground-lighter border-border'
                              : 'bg-destructive/10 text-destructive border-destructive/20'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          resolvedStatus === 'working'
                            ? 'bg-brand'
                            : resolvedStatus === 'standby'
                              ? 'bg-warning'
                              : resolvedStatus === 'idle'
                                ? 'bg-surface-400'
                                : 'bg-destructive'
                        }`}
                      />
                      {resolvedStatus}
                    </span>
                  </div>
                  <p className="text-foreground-light text-sm">{agent.role}</p>
                  {agent.model && (
                    <p className="text-foreground-lighter font-mono text-xs">{agent.model}</p>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="bg-border my-3 w-px shrink-0" />

              {/* Right: personality bio */}
              <div className="flex min-w-0 flex-1 items-center px-4 py-3">
                <AgentBio
                  name={agent.name}
                  params={values}
                  profile={activeProfile}
                  loading={bioLoading}
                />
              </div>
            </div>

            {/* Quick profiles */}
            <div className="space-y-3">
              <div>
                <h2 className="text-foreground text-sm font-semibold">Quick Profiles</h2>
                <p className="text-foreground-lighter mt-0.5 text-xs">
                  Apply a preset to update all parameters at once.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {PROFILES.map((profile) => {
                  const isActive = activeProfile === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => handleProfileSelect(profile.id)}
                      title={profile.description}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-brand border-brand text-black'
                          : 'bg-surface-100 text-foreground-light border-border hover:border-brand/40 hover:text-foreground'
                      }`}
                    >
                      {isActive && <Check className="h-3 w-3" />}
                      {profile.label}
                    </button>
                  );
                })}
                {activeProfile === 'custom' && (
                  <span className="border-border bg-surface-100 text-foreground-lighter inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium">
                    Custom
                  </span>
                )}
              </div>
              {activeProfile !== 'custom' && getProfile(activeProfile) && (
                <p className="text-foreground-lighter text-xs italic">
                  {getProfile(activeProfile)!.description}
                </p>
              )}
            </div>

            {/* Parameters */}
            <div className="space-y-3">
              <div>
                <h2 className="text-foreground text-sm font-semibold">Parameters</h2>
                <p className="text-foreground-lighter mt-0.5 text-xs">
                  0–100 scale. Chat on the right updates with each message.
                </p>
              </div>
              <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2">
                {PARAMETERS.filter(
                  (p) => !['sarcasm', 'self_awareness', 'speed'].includes(p.id),
                ).map((param) => (
                  <ParameterSlider
                    key={param.id}
                    id={param.id}
                    label={param.label}
                    description={param.description}
                    value={values[param.id] ?? DROID_DEFAULTS[param.id] ?? 50}
                    onChange={(v) => handleSliderChange(param.id, v)}
                  />
                ))}
              </div>
            </div>

            {/* TODO: Restore VoiceConfigPanel once voice provider config is fixed (see task) */}
            {/* <VoiceConfigPanel
              agentId={agentId}
              agentName={agent.name}
              onSettingsChange={(settings) => {
                setVoiceSettings(settings);
                clearChat();
              }}
            /> */}

            {/* Agent settings — only for DB-backed agents */}
            {workspaceId && dbAgentConfig && (
              <AgentSettingsPanel
                agentId={agentId}
                workspaceId={workspaceId}
                initialValues={{
                  display_name: dbAgentConfig.display_name,
                  role: dbAgentConfig.role,
                  description: dbAgentConfig.description,
                  color: dbAgentConfig.color,
                  persona_prompt: dbAgentConfig.persona_prompt,
                  model: dbAgentConfig.model,
                }}
                onDeleted={() => router.push(workspaceHref('/agents'))}
                onSaved={(values) => {
                  // Merge saved values into local state so the page reflects changes immediately
                  const defined: Record<string, string> = {};
                  for (const [k, v] of Object.entries(values)) {
                    if (v != null) defined[k] = v;
                  }
                  setDbAgentConfig((prev) => (prev ? { ...prev, ...defined } : prev));
                }}
              />
            )}
          </div>
        </div>

        {/* Right: chat panel — 33% of available width */}
        <div className="bg-surface-75 flex w-1/3 shrink-0 flex-col overflow-hidden">
          {/* Chat header */}
          <div className="border-border flex h-11 shrink-0 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <span className="text-foreground text-sm font-medium">
                Chat with {agentDisplayName}
              </span>
              {activeProfile !== 'custom' && (
                <span className="border-border bg-surface-200 text-foreground-lighter rounded-full border px-2 py-0.5 text-xs">
                  {getProfile(activeProfile)?.label ?? activeProfile}
                </span>
              )}
              {activeProfile === 'custom' && (
                <span className="border-brand/20 bg-brand/5 text-brand rounded-full border px-2 py-0.5 text-xs">
                  Custom
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Voice mode toggle — gated by voice_chat feature flag */}
              {voiceChatEnabled && voiceSettings?.voice_id && (
                <Toggle
                  size="sm"
                  variant="outline"
                  pressed={voiceMode}
                  onPressedChange={(pressed) => {
                    setVoiceMode(pressed);
                    if (!pressed) {
                      voiceActiveRef.current = false;
                      ttsActiveRef.current = false;
                      sentencesEmittedRef.current = false;
                      speech.stop();
                      speech.resetTranscript();
                      tts.stopPlayback();
                      tts.resetHighlight();
                      sentenceQueueRef.current = [];
                      setConversationState('idle');
                    }
                  }}
                  aria-label={voiceMode ? 'Switch to text mode' : 'Switch to voice mode'}
                  className="data-[state=on]:bg-brand/10 data-[state=on]:text-brand data-[state=on]:border-brand/20 gap-1 rounded-full px-2.5 text-xs"
                >
                  {voiceMode ? <Mic className="h-3 w-3" /> : <Type className="h-3 w-3" />}
                  {voiceMode ? 'Voice' : 'Text'}
                </Toggle>
              )}
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearChat}
                  className="text-foreground-lighter hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Voice mode: same chat layout + mic input at bottom */}
          {voiceMode ? (
            <>
              {/* Messages — same layout as text mode */}
              <div
                className="relative flex-1 overflow-hidden"
                role="log"
                aria-label="Chat messages"
                aria-live="polite"
              >
                {/* Top fade */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[20%]"
                  style={{
                    background:
                      'linear-gradient(to bottom, var(--background-surface-75), transparent)',
                  }}
                />

                <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
                  {messages.length === 0 && !chatError ? (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="max-w-[240px] space-y-2 text-center">
                        <div className="bg-surface-200 mx-auto flex h-10 w-10 items-center justify-center rounded-full">
                          <Mic className="text-brand h-5 w-5" />
                        </div>
                        <p className="text-foreground text-sm font-medium">
                          Voice mode with {agentDisplayName}
                        </p>
                        <p className="text-foreground-lighter text-xs leading-relaxed">
                          Tap the mic to start talking. Your words will appear as you speak, and{' '}
                          {agentDisplayName} will respond with voice.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-h-0 flex-1" />
                      <div className="space-y-3">
                        {messages.map((msg, i) => (
                          <ChatMessage
                            key={i}
                            message={msg}
                            index={i}
                            playingIndex={tts.playingIndex}
                            loadingIndex={tts.loadingIndex}
                            onPlay={voiceSettings?.voice_id ? tts.playMessage : undefined}
                            onSkipToEnd={ttsMessageIndex === i ? tts.skipToEnd : undefined}
                            highlightWordIndex={ttsMessageIndex === i ? tts.highlightWordIndex : -1}
                            maxHighlightIndex={ttsMessageIndex === i ? tts.maxHighlightIndex : -1}
                            isHighlighting={
                              ttsMessageIndex === i &&
                              (tts.isSpeaking || tts.maxHighlightIndex >= 0)
                            }
                          />
                        ))}
                        {streaming && messages[messages.length - 1]?.content === '' && (
                          <ThinkingIndicator />
                        )}
                        {chatError && (
                          <div className="border-destructive/30 bg-destructive/10 text-destructive-400 rounded-lg border px-3 py-2 text-xs">
                            {chatError}
                          </div>
                        )}
                        <div ref={bottomRef} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Voice input area — replaces text input */}
              <div className="border-border bg-surface-100 shrink-0 border-t px-4 py-3">
                {/* Error display */}
                {speech.error && (
                  <div className="border-destructive/30 bg-destructive/10 text-destructive mb-2 rounded-lg border px-3 py-2 text-xs">
                    {speech.error}
                  </div>
                )}

                {/* Live transcript in textarea-like container */}
                {(speech.transcript || speech.interimText) && conversationState === 'listening' && (
                  <div className="border-border bg-surface-200 mb-2 rounded-lg border px-3 py-2">
                    <p className="text-foreground text-sm leading-relaxed">
                      {speech.transcript}
                      {speech.interimText && (
                        <span className="text-foreground-lighter italic">
                          {speech.transcript ? ' ' : ''}
                          {speech.interimText}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {/* Mic button + level bars + status */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={conversationState === 'speaking' ? handleInterrupt : handleVoiceToggle}
                    disabled={!speech.isSupported}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                      speech.error
                        ? 'bg-destructive/15 border-destructive/30 text-destructive border'
                        : conversationState === 'speaking'
                          ? 'bg-surface-300 text-foreground-light border-border hover:bg-surface-400 hover:text-foreground border'
                          : conversationState !== 'idle'
                            ? 'bg-destructive text-white shadow-sm'
                            : 'bg-surface-200 text-foreground-light border-border hover:bg-surface-300 hover:text-foreground border'
                    }`}
                    aria-label={
                      conversationState === 'speaking'
                        ? 'Pause speech and start talking'
                        : conversationState !== 'idle'
                          ? 'Stop voice conversation'
                          : 'Start voice conversation'
                    }
                  >
                    {conversationState === 'speaking' ? (
                      <Pause className="h-4 w-4" />
                    ) : conversationState !== 'idle' ? (
                      <Square className="h-3.5 w-3.5 fill-current" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>

                  {/* Audio level bars — compact inline version */}
                  {conversationState === 'listening' && !speech.error && (
                    <div className="flex h-6 flex-1 items-center gap-[2px]">
                      {micLevels.slice(0, 32).map((level, i) => {
                        const height = 3 + level * 18;
                        const hasSignal = level > 0.05;
                        return (
                          <div
                            key={i}
                            className="rounded-full transition-all duration-75"
                            style={{
                              width: '2px',
                              height: `${height}px`,
                              backgroundColor: hasSignal
                                ? `hsl(153deg 60% 53% / ${0.4 + level * 0.6})`
                                : 'var(--foreground-muted)',
                              opacity: hasSignal ? 1 : 0.2,
                              flex: '1 1 0',
                              maxWidth: '4px',
                            }}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Status text */}
                  {conversationState !== 'idle' && !speech.error && (
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        conversationState === 'listening' && speech.isPendingSend
                          ? 'text-warning animate-pulse'
                          : conversationState === 'listening'
                            ? 'text-brand'
                            : conversationState === 'processing'
                              ? 'text-foreground-lighter'
                              : conversationState === 'speaking'
                                ? 'text-foreground-lighter'
                                : 'text-foreground-lighter'
                      }`}
                    >
                      {conversationState === 'listening' && speech.isPendingSend
                        ? 'Paused — still listening…'
                        : conversationState === 'listening'
                          ? 'Listening…'
                          : conversationState === 'heard'
                            ? 'Heard you…'
                            : conversationState === 'processing'
                              ? 'Thinking…'
                              : conversationState === 'speaking'
                                ? 'Speaking — tap to interrupt'
                                : ''}
                    </span>
                  )}

                  {conversationState === 'idle' && !speech.error && (
                    <span className="text-foreground-lighter flex-1 text-xs">
                      Tap mic to talk with {agentDisplayName}
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Messages */}
              <div
                className="relative flex-1 overflow-hidden"
                role="log"
                aria-label="Chat messages"
                aria-live="polite"
              >
                {/* Top fade */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[20%]"
                  style={{
                    background:
                      'linear-gradient(to bottom, var(--background-surface-75), transparent)',
                  }}
                />

                <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
                  {messages.length === 0 && !chatError ? (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="max-w-[240px] space-y-2 text-center">
                        <div className="bg-surface-200 mx-auto flex h-10 w-10 items-center justify-center rounded-full">
                          <Bot className="text-brand h-5 w-5" />
                        </div>
                        <p className="text-foreground text-sm font-medium">
                          {agentDisplayName} is ready
                        </p>
                        <p className="text-foreground-lighter text-xs leading-relaxed">
                          Each message uses the current slider values. Adjust parameters and send
                          another message to compare responses.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-h-0 flex-1" />
                      <div className="space-y-3">
                        {messages.map((msg, i) => (
                          <ChatMessage
                            key={i}
                            message={msg}
                            index={i}
                            playingIndex={tts.playingIndex}
                            loadingIndex={tts.loadingIndex}
                            onPlay={voiceSettings?.voice_id ? tts.playMessage : undefined}
                          />
                        ))}
                        {streaming && messages[messages.length - 1]?.content === '' && (
                          <ThinkingIndicator />
                        )}
                        {chatError && (
                          <div className="border-destructive/30 bg-destructive/10 text-destructive-400 rounded-lg border px-3 py-2 text-xs">
                            {chatError}
                          </div>
                        )}
                        <div ref={bottomRef} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Text input */}
              <div className="border-border bg-surface-100 shrink-0 border-t px-4 py-3">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${agentDisplayName}…`}
                    rows={1}
                    disabled={streaming}
                    className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-brand/50 focus:ring-brand/30 flex-1 resize-none overflow-hidden rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:opacity-50"
                    style={{ minHeight: '38px', maxHeight: '120px' }}
                  />
                  <Button
                    size="md"
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || streaming}
                    aria-label="Send message"
                    className="h-[38px] shrink-0 border-l-2 px-3"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-foreground-lighter mt-1.5 text-xs">
                  Enter to send, Shift+Enter for new line
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
