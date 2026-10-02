'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Key,
  Loader2,
  BookOpen,
  MessageSquare,
  Zap,
  XCircle,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import Image from 'next/image';
import { toast } from 'sonner';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import {
  markOnboardingComplete as _markOnboardingComplete,
  markOnboardingStarted,
} from './use-onboarding';

/** Wraps markOnboardingComplete to also clear persisted state. */
async function markOnboardingComplete() {
  localStorage.removeItem('onboarding_step');
  localStorage.removeItem('onboarding_firstName');
  return _markOnboardingComplete();
}
import { AsciiWaves } from '../auth/ascii-waves';
import dynamic from 'next/dynamic';
import { ConnectionsStep } from './connections-step';
import { KnowledgeStep } from './knowledge-step';
import { ChatErrorBoundary } from './chat-error-boundary';

const OnboardingChat = dynamic(
  () => import('./onboarding-chat').then((mod) => ({ default: mod.OnboardingChat })),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    ),
  },
);
import { AgentBioCard, type BioCardPhase } from './agent-bio-card';
import {
  VoiceGreetingButton,
  getPersonalityGreeting,
  personalityToVoiceParams,
} from './voice-greeting-button';
import { DROID_DEFAULTS, type ParameterValues } from '@/lib/agents-data';

interface OnboardingFullScreenProps {
  onClose: () => void;
  onFinish?: () => void;
}

type Step = 'welcome' | 'connections' | 'knowledge' | 'chat';

const STEPS: Step[] = ['welcome', 'connections', 'knowledge', 'chat'];

const STEP_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  welcome: { label: 'Welcome', icon: Zap },
  connections: { label: 'Connect Tools', icon: Key },
  knowledge: { label: 'Knowledge', icon: BookOpen },
  chat: { label: 'Agent Interview', icon: MessageSquare },
};

// ---------------------------------------------------------------------------
// Tab Bar
// ---------------------------------------------------------------------------

function OnboardingTabs({ current, onSelect }: { current: Step; onSelect: (s: Step) => void }) {
  const idx = STEPS.indexOf(current);

  return (
    <nav className="flex items-center gap-0.5" role="tablist" aria-label="Onboarding steps">
      {STEPS.map((s, i) => {
        const isActive = i === idx;
        const isComplete = i < idx;
        const isClickable = isComplete;
        const meta = STEP_META[s];
        const Icon = meta.icon;

        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={meta.label}
            onClick={() => isClickable && onSelect(s)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              isActive
                ? 'bg-white/10 text-white'
                : isComplete
                  ? 'cursor-pointer text-white/60 hover:bg-white/5 hover:text-white'
                  : 'cursor-default text-white/60'
            }`}
          >
            {isComplete && !isActive ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="whitespace-nowrap">{meta.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Right Panel Content — contextual info per step
// ---------------------------------------------------------------------------

function RightPanelContent({
  step,
  orgName,
  bioCardPhase,
  personalityValues,
  onPersonalityChange,
  ttsCallCount,
  onTTSCall,
  agentName,
  onNameChange,
  avatarUrl,
  onAvatarChange,
  voices,
  selectedVoiceId,
  onVoiceChange,
  onPlayVoiceSample,
  voiceSamplePlaying,
}: {
  step: Step;
  orgName: string;
  bioCardPhase: BioCardPhase;
  personalityValues: ParameterValues;
  onPersonalityChange: (v: ParameterValues) => void;
  ttsCallCount: number;
  onTTSCall: () => void;
  agentName: string;
  onNameChange: (name: string) => void;
  avatarUrl: string | null;
  onAvatarChange: (url: string) => void;
  voices: { voice_id: string; name: string; category?: string }[];
  selectedVoiceId: string;
  onVoiceChange: (voiceId: string) => void;
  onPlayVoiceSample: (voiceId: string) => void;
  voiceSamplePlaying: boolean;
}) {
  const voiceSlot =
    bioCardPhase !== 'identity' ? (
      <VoiceGreetingButton
        onTTSCall={onTTSCall}
        disabled={ttsCallCount >= 10}
        text={getPersonalityGreeting(personalityValues)}
        voiceParams={personalityToVoiceParams(personalityValues)}
      />
    ) : undefined;

  const heading =
    step === 'welcome'
      ? 'Meet Your Lead Agent'
      : step === 'chat'
        ? null
        : `Hello, ${orgName || 'there'}.`;

  return (
    <div className="relative z-10 flex h-full items-center justify-center p-6 lg:p-10">
      <div className="flex w-full max-w-lg flex-col items-center">
        {heading && (
          <h2 className="mb-6 text-4xl font-light tracking-tight text-white lg:text-5xl">
            {heading}
          </h2>
        )}
        <AgentBioCard
          phase={bioCardPhase}
          values={personalityValues}
          onValuesChange={onPersonalityChange}
          voiceSlot={voiceSlot}
          agentName={agentName}
          onNameChange={onNameChange}
          avatarUrl={avatarUrl}
          onAvatarChange={onAvatarChange}
          voices={voices}
          selectedVoiceId={selectedVoiceId}
          onVoiceChange={onVoiceChange}
          onPlayVoiceSample={onPlayVoiceSample}
          voiceSamplePlaying={voiceSamplePlaying}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Synthesizing Overlay — shown inside chat container after conversation ends
// ---------------------------------------------------------------------------

const SYNTH_STEPS = [
  { label: 'Saving memories from your conversation', key: 'memories' },
  { label: 'Analyzing your goals and priorities', key: 'goals' },
  { label: 'Generating personalized projects', key: 'projects' },
  { label: 'Creating your first tasks', key: 'tasks' },
  { label: 'Configuring your agent team', key: 'agents' },
  { label: 'Building your knowledge base', key: 'brain' },
];

type SynthStepStatus = 'pending' | 'running' | 'done' | 'error';

function SynthesizingOverlay({
  onDone,
  generationStatus,
  agentName,
  avatarUrl,
  firstName,
  orgName,
}: {
  onDone: () => void;
  generationStatus: 'idle' | 'pending' | 'complete' | 'error';
  agentName: string;
  avatarUrl: string;
  firstName: string;
  orgName: string;
}) {
  const [stepStatuses, setStepStatuses] = useState<SynthStepStatus[]>(
    SYNTH_STEPS.map(() => 'pending'),
  );
  const [fadeIn, setFadeIn] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);

  // Fade in on mount
  useEffect(() => {
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

  // Show "this may take a minute" after 2s on the projects step
  useEffect(() => {
    const projectsIdx = SYNTH_STEPS.findIndex((s) => s.key === 'projects');
    if (stepStatuses[projectsIdx] === 'running') {
      const t = setTimeout(() => setShowSlowHint(true), 2000);
      return () => clearTimeout(t);
    }
    setShowSlowHint(false);
  }, [stepStatuses]);

  // Advance steps sequentially with staggered timing
  const stepCount = SYNTH_STEPS.length;

  useEffect(() => {
    // Step 1 (memories): start immediately — already saved during chat
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(() => {
        setStepStatuses((prev) => {
          const n = [...prev];
          n[0] = 'running';
          return n;
        });
      }, 300),
    );
    timers.push(
      setTimeout(() => {
        setStepStatuses((prev) => {
          const n = [...prev];
          n[0] = 'done';
          n[1] = 'running';
          return n;
        });
      }, 1200),
    );
    // Step 2 (goals): completes after a brief analysis
    timers.push(
      setTimeout(() => {
        setStepStatuses((prev) => {
          const n = [...prev];
          n[1] = 'done';
          n[2] = 'running';
          return n;
        });
      }, 2800),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // React to generation status changes — advance remaining steps
  useEffect(() => {
    if (generationStatus === 'complete') {
      const timers: ReturnType<typeof setTimeout>[] = [];
      // Mark goals + projects done, start tasks
      setStepStatuses((prev) => {
        const n = [...prev];
        n[0] = 'done';
        n[1] = 'done';
        n[2] = 'done';
        n[3] = 'running';
        return n;
      });
      timers.push(
        setTimeout(() => {
          setStepStatuses((prev) => {
            const n = [...prev];
            n[3] = 'done';
            n[4] = 'running';
            return n;
          });
        }, 400),
      );
      timers.push(
        setTimeout(() => {
          setStepStatuses((prev) => {
            const n = [...prev];
            n[4] = 'done';
            n[5] = 'running';
            return n;
          });
        }, 800),
      );
      timers.push(
        setTimeout(() => {
          setStepStatuses((prev) => {
            const n = [...prev];
            n[5] = 'done';
            return n;
          });
        }, 1200),
      );
      return () => timers.forEach(clearTimeout);
    }
    if (generationStatus === 'error') {
      setStepStatuses((prev) => {
        const n = [...prev];
        for (let i = 0; i < n.length; i++) {
          if (n[i] === 'running' || n[i] === 'pending') {
            n[i] = 'error';
            break;
          }
        }
        return n;
      });
    }
  }, [generationStatus]);

  const doneCount = stepStatuses.filter((s) => s === 'done').length;
  const allDone = doneCount === stepCount;
  const hasError = stepStatuses.some((s) => s === 'error');
  const canProceed = allDone || hasError;

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center transition-opacity duration-500 ${
        fadeIn ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex w-full max-w-lg flex-col items-start px-8">
        {/* Title */}
        <h2 className="mb-3 text-4xl font-light tracking-tight text-white lg:text-5xl">
          Setting up {orgName || 'your workspace'}
        </h2>
        <p className="mb-8 text-base leading-relaxed font-light text-white/60">
          It was nice to meet you{firstName ? `, ${firstName}` : ''}! Using what I learned to
          personalize your workspace&hellip;
        </p>

        {/* Overall progress bar */}
        <div className="mb-6 w-full">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-white/50">
              {doneCount} of {stepCount} steps complete
            </span>
            <span className="text-xs text-white/50">
              {Math.round((doneCount / stepCount) * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="bg-brand h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${(doneCount / stepCount) * 100}%` }}
            />
          </div>
        </div>

        {/* Step list */}
        <div className="flex w-full flex-col gap-3">
          {SYNTH_STEPS.map((s, i) => {
            const status = stepStatuses[i];
            return (
              <div
                key={s.key}
                className={`flex items-center gap-3 transition-all duration-400 ${
                  status === 'pending' ? 'opacity-40' : 'opacity-100'
                }`}
              >
                {status === 'done' ? (
                  <CheckCircle2 className="text-brand h-4 w-4 shrink-0" />
                ) : status === 'running' ? (
                  <Loader2 className="text-brand h-4 w-4 shrink-0 animate-spin" />
                ) : status === 'error' ? (
                  <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                ) : (
                  <div className="h-4 w-4 shrink-0 rounded-full border border-white/20" />
                )}
                <span
                  className={`text-sm ${
                    status === 'done'
                      ? 'text-white/60'
                      : status === 'running'
                        ? 'text-white'
                        : status === 'error'
                          ? 'text-red-400'
                          : 'text-white/40'
                  }`}
                >
                  {s.label}
                  {s.key === 'projects' && status === 'running' && showSlowHint && (
                    <span className="ml-2 text-white/60">this may take a minute...</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {hasError && (
          <p className="mt-4 text-sm text-white/50">
            Something went wrong, but you can still explore your workspace.
          </p>
        )}

        {/* Take me to Celune button */}
        <Button
          onClick={onDone}
          disabled={!canProceed}
          className="mt-8 w-full gap-2 text-black disabled:opacity-30"
        >
          {canProceed ? (
            <>
              Take me to Celune
              <ArrowRight className="h-4 w-4" />
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Setting up your workspace&hellip;
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Full-Screen Onboarding
// ---------------------------------------------------------------------------

export function OnboardingFullScreen({ onClose, onFinish }: OnboardingFullScreenProps) {
  const router = useRouter();
  const [exitLoading, setExitLoading] = useState(false);

  async function handleExit() {
    setExitLoading(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch {
      setExitLoading(false);
    }
  }

  const [step, setStepRaw] = useState<Step>(() => {
    if (typeof window === 'undefined') return 'welcome';
    const saved = localStorage.getItem('onboarding_step');
    return saved && STEPS.includes(saved as Step) ? (saved as Step) : 'welcome';
  });

  const setStep = useCallback((s: Step) => {
    setStepRaw(s);
    localStorage.setItem('onboarding_step', s);
  }, []);
  const [firstName, setFirstNameRaw] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('onboarding_firstName') ?? '';
  });
  const setFirstName = useCallback((v: string) => {
    setFirstNameRaw(v);
    localStorage.setItem('onboarding_firstName', v);
  }, []);
  const [orgName, setOrgName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const [personalityValues, setPersonalityValues] = useState<ParameterValues>({
    ...DROID_DEFAULTS,
  });
  const [ttsCallCount, setTtsCallCount] = useState(0);
  const [agentName, setAgentName] = useState('RICK');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [voices, setVoices] = useState<{ voice_id: string; name: string; category?: string }[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceSamplePlaying, setVoiceSamplePlaying] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<
    'idle' | 'pending' | 'complete' | 'error'
  >('idle');
  const [transitioning, setTransitioning] = useState(false);
  const voiceSampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const { activeWorkspace, workspaces, refreshWorkspaces, switchToWorkspaceBySlug } =
    useWorkspace();

  // Fetch available voices on mount
  useEffect(() => {
    fetch(apiUrl('/api/agents/rick/voice'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.voices) {
          setVoices(
            data.voices.map((v: { voice_id: string; name: string; category?: string }) => ({
              voice_id: v.voice_id,
              name: v.name,
              category: v.category ?? 'premade',
            })),
          );
        }
        if (data?.current?.voice_id) {
          setSelectedVoiceId(data.current.voice_id);
        }
      })
      .catch(() => {
        /* Voice list is optional — card works without it */
      });
  }, []);

  const handlePlayVoiceSample = useCallback(
    async (voiceId: string) => {
      if (voiceSamplePlaying) {
        voiceSampleAudioRef.current?.pause();
        voiceSampleAudioRef.current = null;
        setVoiceSamplePlaying(false);
        return;
      }

      setVoiceSamplePlaying(true);
      try {
        const previewUrl = effectiveWorkspaceId
          ? apiUrl(`/api/agents/rick/voice/preview?workspace_id=${effectiveWorkspaceId}`)
          : apiUrl('/api/agents/rick/voice/preview');
        const res = await fetch(previewUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: getPersonalityGreeting(personalityValues),
            params: personalityToVoiceParams(personalityValues),
            voice_id: voiceId,
          }),
        });
        if (!res.ok) {
          setVoiceSamplePlaying(false);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        voiceSampleAudioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          voiceSampleAudioRef.current = null;
          setVoiceSamplePlaying(false);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setVoiceSamplePlaying(false);
        };
        await audio.play();
      } catch {
        setVoiceSamplePlaying(false);
      }
    },
    [voiceSamplePlaying, personalityValues],
  );

  // Derive bio card phase from current step — progressive reveal
  const bioCardPhase: BioCardPhase =
    step === 'welcome'
      ? 'identity'
      : step === 'connections'
        ? 'voice'
        : step === 'knowledge'
          ? 'voice'
          : 'personality';

  const effectiveWorkspaceId = createdWorkspaceId ?? activeWorkspace?.id ?? null;

  // Preload chat module while user is on connections step
  useEffect(() => {
    if (step === 'connections') {
      import('./onboarding-chat').catch(() => {});
    }
  }, [step]);

  async function handleSkip() {
    await markOnboardingComplete();
    onClose();
  }

  function handleReset() {
    localStorage.removeItem('onboarding_step');
    localStorage.removeItem('onboarding_firstName');
    setStepRaw('welcome');
    setFirstNameRaw('');
    setOrgName('');
    setWorkspaceName('');
    setSaving(false);
    setPersonalityValues({ ...DROID_DEFAULTS });
    setAgentName('RICK');
    setAvatarUrl(null);
    setTtsCallCount(0);
  }

  async function handleWelcomeContinue() {
    setSaving(true);
    try {
      const profileUpdates: Record<string, string> = {};
      if (firstName.trim()) {
        profileUpdates.first_name = firstName.trim();
        profileUpdates.display_name = firstName.trim();
      }
      if (orgName.trim()) profileUpdates.org_name = orgName.trim();

      if (Object.keys(profileUpdates).length > 0) {
        await fetch(apiUrl('/api/user/profile'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profileUpdates),
        }).catch(() => {
          /* Best-effort — profile fields are non-blocking for onboarding */
        });
      }

      // Update default workspace name to match org name
      if (orgName.trim() && activeWorkspace?.is_default) {
        await fetch(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: orgName.trim() }),
        }).catch(() => {});
        await refreshWorkspaces();
      }

      if (workspaceName.trim() && !activeWorkspace) {
        const res = await fetch(apiUrl('/api/workspaces'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workspaceName.trim() || orgName.trim() }),
        });

        if (res.ok) {
          const ws = await res.json();
          setCreatedWorkspaceId(ws.id);
          await refreshWorkspaces();
        } else {
          toast.error('Could not create workspace. You can create one later in Settings.');
        }
      }

      await markOnboardingStarted();
    } catch {
      // Non-blocking
    } finally {
      setSaving(false);
    }

    setStep('connections');
  }

  function handleConnectionsContinue() {
    setTransitioning(true);
    setTimeout(() => {
      setStep('knowledge');
      setTransitioning(false);
    }, 500);
  }

  function handleKnowledgeContinue() {
    setTransitioning(true);
    setTimeout(() => {
      setStep('chat');
      setTransitioning(false);
    }, 500);
  }

  async function handleChatComplete() {
    // Chat is done — show synthesizing interstitial, fire generation in background.
    if (!effectiveWorkspaceId) return;

    const wsId = effectiveWorkspaceId;

    // Signal the dashboard loader BEFORE firing the POST — avoids race condition
    localStorage.setItem(`onboarding_generation_pending_${wsId}`, 'true');

    // Show synthesizing overlay on top of chat
    setGenerationStatus('pending');

    // Save personality settings, agent name, and avatar to workspace agent config
    fetch(apiUrl(`/api/agents/rick/config?workspace_id=${wsId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parameters: personalityValues,
        display_name: agentName,
        icon: avatarUrl || '/avatars/Shape_1.png',
      }),
    }).catch(() => {
      /* Best-effort — personality save is non-blocking */
    });

    await markOnboardingComplete();

    // Fire generation with retry — awaited so synthesizing screen tracks real status.
    const MAX_RETRIES = 3;
    let succeeded = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(apiUrl('/api/onboarding/generate-projects'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: wsId }),
        });
        if (res.ok) {
          succeeded = true;
          break;
        }
        const errBody = await res.text().catch(() => '');
        console.error(
          `[onboarding] Generation attempt ${attempt}/${MAX_RETRIES} failed: ${res.status}`,
          errBody,
        );
      } catch (err) {
        console.error(`[onboarding] Generation attempt ${attempt}/${MAX_RETRIES} error:`, err);
      }
      // Wait before retrying (2s, 4s)
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }

    if (succeeded) {
      setGenerationStatus('complete');
      localStorage.removeItem(`onboarding_generation_pending_${wsId}`);
    } else {
      setGenerationStatus('error');
      try {
        localStorage.setItem(`onboarding_generation_error_${wsId}`, 'true');
      } catch {
        /* localStorage unavailable */
      }
    }
  }

  async function handleSynthesizingDone() {
    // Refresh workspaces to pick up the one created during onboarding
    await refreshWorkspaces();

    // Navigate to the user's actual workspace (not the Main org workspace).
    // Try: created workspace ID → first non-default workspace → fallback to any.
    const targetWsId = createdWorkspaceId ?? effectiveWorkspaceId;
    const fresh = await fetchJson<Array<{ id: string; slug: string; is_default?: boolean }>>(
      apiUrl('/api/workspaces'),
    ).catch(() => []);

    const userWs =
      fresh.find((w) => w.id === targetWsId) ?? fresh.find((w) => !w.is_default) ?? fresh[0];

    // Persist lead agent settings from onboarding to agent_configs.
    // The seed (handleGitHubContinue) already created a "rick" agent, so we
    // use PUT to update the existing config with the user's customizations.
    if (targetWsId && agentName) {
      try {
        await fetch(apiUrl(`/api/agents/rick/config?workspace_id=${targetWsId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: agentName,
            role: 'Team Lead',
            description:
              'Your lead agent — plans work, coordinates the team, and drives projects forward.',
            color: '#3DD68C',
            persona_prompt: `You are ${agentName}, the team lead. You plan, coordinate, and execute. You break complex work into clear steps, delegate to specialists, and ensure quality. You're direct, pragmatic, and focused on outcomes.`,
            parameters: personalityValues,
          }),
        });
      } catch {
        // Non-blocking — seed already created a fallback lead
      }
    }

    onClose();
    onFinish?.();

    if (userWs?.slug) {
      switchToWorkspaceBySlug(userWs.slug);
    }
  }

  // Show synthesizing overlay when generation is in progress (overlays the chat)
  const showSynthesizing = generationStatus !== 'idle';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]">
      {/* Top Bar — transparent overlay */}
      <header
        className={`absolute inset-x-0 top-0 z-30 flex w-full items-center px-6 py-3 transition-opacity duration-500 ${
          transitioning ? 'pointer-events-none opacity-0' : ''
        }`}
      >
        <div className="flex items-center gap-4">
          <Image
            src="/celune-logo-full.svg"
            alt="Celune"
            className="h-5 w-auto"
            width={100}
            height={20}
            unoptimized
          />
          {step !== 'welcome' && (
            <button
              type="button"
              onClick={() => {
                if (step === 'chat') setStep('knowledge');
                else if (step === 'knowledge') setStep('connections');
                else if (step === 'connections') setStep('welcome');
              }}
              className="mt-0.5 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/60"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
          )}
        </div>

        {/* Onboarding step indicator — centered in nav */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const idx = STEPS.indexOf(step);
              const isDone = i < idx;
              const isActive = i === idx;
              const meta = STEP_META[s];
              const Icon = meta.icon;
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && (
                    <div className={`h-px w-6 ${isDone ? 'bg-[#5BC586]/40' : 'bg-white/[0.06]'}`} />
                  )}
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                        isDone
                          ? 'bg-[#5BC586] text-white'
                          : isActive
                            ? 'border border-[#5BC586] text-[#5BC586]'
                            : 'border border-white/[0.12] text-white/[0.33]'
                      }`}
                    >
                      {isDone && <CheckCircle2 className="h-3 w-3" />}
                      {isActive && <span className="h-2 w-2 rounded-full bg-[#5BC586]" />}
                    </div>
                    <span
                      className={`text-xs ${
                        isDone
                          ? 'text-white/[0.66]'
                          : isActive
                            ? 'text-white/[0.87]'
                            : 'text-white/[0.33]'
                      }`}
                    >
                      {meta.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ml-auto">
          <button
            type="button"
            onClick={handleExit}
            disabled={exitLoading}
            className="flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:border-white/40 hover:text-white disabled:opacity-40"
          >
            {exitLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Exit
          </button>
        </div>
      </header>

      {/* Main Content Area — always split layout */}
      <div
        className={`flex min-h-0 flex-1 transition-opacity duration-500 ease-in-out ${
          transitioning ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Left side */}
        <div className="flex w-full flex-col overflow-y-auto lg:w-1/2">
          {step === 'chat' ? (
            /* Chat fills the left panel */
            <div className="relative flex min-h-0 flex-1 flex-col">
              {showSynthesizing ? (
                <div className="flex flex-1 items-center justify-center">
                  <SynthesizingOverlay
                    onDone={handleSynthesizingDone}
                    generationStatus={generationStatus}
                    agentName={agentName}
                    avatarUrl={avatarUrl || '/avatars/bots/bot1.jpg'}
                    firstName={firstName}
                    orgName={orgName}
                  />
                </div>
              ) : (
                <ChatErrorBoundary onSkip={handleSkip}>
                  {effectiveWorkspaceId ? (
                    <OnboardingChat
                      workspaceId={effectiveWorkspaceId}
                      onComplete={handleChatComplete}
                      onSkip={handleSkip}
                      onBack={() => setStep('knowledge')}
                      avatarUrl={avatarUrl}
                      agentName={agentName}
                      userName={firstName}
                      personalityValues={personalityValues}
                      onPersonalityChange={setPersonalityValues}
                    />
                  ) : (
                    <OnboardingChatPlaceholder
                      workspaceId={effectiveWorkspaceId}
                      onComplete={handleChatComplete}
                      onSkip={handleSkip}
                    />
                  )}
                </ChatErrorBoundary>
              )}
            </div>
          ) : (
            /* Welcome + Connections forms */
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-md px-6 py-10">
                {step === 'welcome' && (
                  <WelcomeStep
                    firstName={firstName}
                    onFirstNameChange={setFirstName}
                    orgName={orgName}
                    onOrgNameChange={setOrgName}
                    onContinue={handleWelcomeContinue}
                    saving={saving}
                  />
                )}
                {step === 'connections' && effectiveWorkspaceId && (
                  <ConnectionsStep
                    workspaceId={effectiveWorkspaceId}
                    onContinue={handleConnectionsContinue}
                  />
                )}
                {step === 'knowledge' && effectiveWorkspaceId && (
                  <KnowledgeStep
                    onComplete={handleKnowledgeContinue}
                    onSkip={handleKnowledgeContinue}
                    workspaceId={effectiveWorkspaceId}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right side — ASCII waves + agent card */}
        <div className="relative hidden lg:block lg:w-1/2">
          <div className="absolute inset-0 bg-[#0a0a0a]">
            <AsciiWaves speed={0.3} className="opacity-50" />
          </div>
          <RightPanelContent
            step={step}
            orgName={firstName || orgName}
            bioCardPhase={bioCardPhase}
            personalityValues={personalityValues}
            onPersonalityChange={setPersonalityValues}
            ttsCallCount={ttsCallCount}
            onTTSCall={() => setTtsCallCount((c) => c + 1)}
            agentName={agentName}
            onNameChange={setAgentName}
            avatarUrl={avatarUrl}
            onAvatarChange={setAvatarUrl}
            voices={voices}
            selectedVoiceId={selectedVoiceId}
            onVoiceChange={setSelectedVoiceId}
            onPlayVoiceSample={handlePlayVoiceSample}
            voiceSamplePlaying={voiceSamplePlaying}
          />
        </div>
      </div>

      {/* Bounce keyframes */}
      <style>{`
        @keyframes onboarding-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Welcome
// ---------------------------------------------------------------------------

function WelcomeStep({
  firstName,
  onFirstNameChange,
  orgName,
  onOrgNameChange,
  onContinue,
  saving,
}: {
  firstName: string;
  onFirstNameChange: (v: string) => void;
  orgName: string;
  onOrgNameChange: (v: string) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-light tracking-tight text-white lg:text-5xl">
          Welcome to Celune
        </h1>
        <p className="mt-6 text-base leading-relaxed font-light text-white/90">
          Your platform for managing projects, tasks, and your AI agent team. Let&apos;s get you set
          up in a few quick steps.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-base font-bold text-white">Your Name</label>
          <input
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
            autoFocus
            className="block w-full rounded-md border border-white/[0.04] bg-white/5 px-3 py-2.5 text-sm font-light text-white transition-colors placeholder:text-white/50 focus:border-white/20 focus:ring-1 focus:ring-white/10 focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-base font-bold text-white">Organization</label>
          <input
            value={orgName}
            onChange={(e) => onOrgNameChange(e.target.value)}
            className="block w-full rounded-md border border-white/[0.04] bg-white/5 px-3 py-2.5 text-sm font-light text-white transition-colors placeholder:text-white/50 focus:border-white/20 focus:ring-1 focus:ring-white/10 focus:outline-none"
          />
        </div>
      </div>

      <Button
        onClick={onContinue}
        className="mt-4 w-full gap-2 text-black"
        disabled={saving || !firstName.trim()}
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Setting up...
          </>
        ) : (
          <>
            Continue
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding Chat — Placeholder (Sprint 2 builds the real streaming UI)
// ---------------------------------------------------------------------------

function OnboardingChatPlaceholder({
  onComplete,
}: {
  workspaceId: string | null;
  onComplete: () => void;
  onSkip: () => void;
}) {
  // Auto-advance once workspace is ready — just show a loader
  useEffect(() => {
    // If we're shown it means workspace isn't ready yet; parent will swap us out
  }, [onComplete]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-white/40" />
      <p className="mt-4 text-sm text-white/40">Setting up your conversation...</p>
    </div>
  );
}
