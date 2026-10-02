'use client';

import { useState, useCallback } from 'react';
import { Volume2, Check, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { Dialog, DialogContent, DialogTitle } from '@repo/ui/components/dialog';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlanLimitToast } from '@/hooks/use-plan-limit-toast';
import { AGENT_COLOR_PRESETS_COMPACT } from '@/lib/agent-colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = 'name' | 'archetype' | 'custom' | 'voice' | 'avatar' | 'creating';

interface Archetype {
  id: string;
  name: string;
  tagline: string;
  openingLine: string;
  color: string;
  icon: string;
  traits: { label: string; value: number }[];
}

interface VoiceOption {
  id: string;
  name: string;
  accent: string;
  vibe: string;
  previewText: string;
}

const ARCHETYPES: Archetype[] = [
  {
    id: 'strategist',
    name: 'THE STRATEGIST',
    tagline: 'Plans, prioritizes, cuts through noise',
    openingLine: "Let's figure out what actually matters.",
    color: '#3B82F6',
    icon: '🎯',
    traits: [
      { label: 'Directness', value: 75 },
      { label: 'Confidence', value: 85 },
      { label: 'Formality', value: 40 },
    ],
  },
  {
    id: 'analyst',
    name: 'THE ANALYST',
    tagline: 'Researches, synthesizes, finds patterns',
    openingLine: "I'll dig into the data for you.",
    color: '#8B5CF6',
    icon: '🔍',
    traits: [
      { label: 'Precision', value: 90 },
      { label: 'Formality', value: 70 },
      { label: 'Directness', value: 75 },
    ],
  },
  {
    id: 'coach',
    name: 'THE COACH',
    tagline: 'Motivates, reflects, builds skills',
    openingLine: 'What are you working toward?',
    color: '#10B981',
    icon: '🌱',
    traits: [
      { label: 'Warmth', value: 85 },
      { label: 'Humor', value: 60 },
      { label: 'Patience', value: 90 },
    ],
  },
  {
    id: 'builder',
    name: 'THE BUILDER',
    tagline: 'Creates, drafts, ships',
    openingLine: "Let's make something.",
    color: '#F59E0B',
    icon: '🔨',
    traits: [
      { label: 'Directness', value: 90 },
      { label: 'Autonomy', value: 80 },
      { label: 'Speed', value: 85 },
    ],
  },
  {
    id: 'connector',
    name: 'THE CONNECTOR',
    tagline: 'Networks, manages relationships, coordinates',
    openingLine: 'Who do you need to bring in?',
    color: '#EC4899',
    icon: '🤝',
    traits: [
      { label: 'Warmth', value: 80 },
      { label: 'Social', value: 90 },
      { label: 'Empathy', value: 85 },
    ],
  },
  {
    id: 'guardian',
    name: 'THE GUARDIAN',
    tagline: 'Tracks, reminds, manages details',
    openingLine: 'Nothing falls through the cracks.',
    color: '#6366F1',
    icon: '🛡️',
    traits: [
      { label: 'Reliability', value: 95 },
      { label: 'Thoroughness', value: 90 },
      { label: 'Autonomy', value: 70 },
    ],
  },
];

// Placeholder voice options — will be populated from ElevenLabs voice library
const VOICE_OPTIONS: Record<string, VoiceOption[]> = {
  strategist: [
    {
      id: 'pNInz6obpgDQGcFmaJgB',
      name: 'Adam',
      accent: 'American',
      vibe: 'Confident, clear',
      previewText: "Here's what I found. Three things need your attention today.",
    },
    {
      id: 'ErXwobaYiN019PkySvjV',
      name: 'Antoni',
      accent: 'American',
      vibe: 'Warm, professional',
      previewText: 'Let me walk you through the priorities.',
    },
    {
      id: 'VR6AewLTigWG4xSOukaG',
      name: 'Arnold',
      accent: 'American',
      vibe: 'Direct, measured',
      previewText: "I've analyzed the situation. Here's what stands out.",
    },
    {
      id: 'TxGEqnHWrfWFTfGW9XjX',
      name: 'Josh',
      accent: 'American',
      vibe: 'Calm, authoritative',
      previewText: 'Three priorities for today. Let me break them down.',
    },
    {
      id: 'onwK4e9ZLuTAKqWW03F9',
      name: 'Daniel',
      accent: 'British',
      vibe: 'Polished, steady',
      previewText: "I've mapped out the critical path. Shall we review?",
    },
    {
      id: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      accent: 'American',
      vibe: 'Sharp, decisive',
      previewText: 'The data points to three clear actions.',
    },
  ],
  analyst: [
    {
      id: 'pNInz6obpgDQGcFmaJgB',
      name: 'Adam',
      accent: 'American',
      vibe: 'Clear, measured',
      previewText: "I pulled the data. There's a pattern here you should see.",
    },
    {
      id: 'ErXwobaYiN019PkySvjV',
      name: 'Antoni',
      accent: 'American',
      vibe: 'Thoughtful',
      previewText: 'The numbers tell an interesting story.',
    },
    {
      id: 'onwK4e9ZLuTAKqWW03F9',
      name: 'Daniel',
      accent: 'British',
      vibe: 'Precise, formal',
      previewText: "I've cross-referenced three data sources.",
    },
    {
      id: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      accent: 'American',
      vibe: 'Focused, clear',
      previewText: "Here's what the research shows.",
    },
    {
      id: 'TxGEqnHWrfWFTfGW9XjX',
      name: 'Josh',
      accent: 'American',
      vibe: 'Steady, detailed',
      previewText: 'I found something worth examining closely.',
    },
    {
      id: 'VR6AewLTigWG4xSOukaG',
      name: 'Arnold',
      accent: 'American',
      vibe: 'Analytical',
      previewText: 'The analysis reveals three key insights.',
    },
  ],
  coach: [
    {
      id: 'ErXwobaYiN019PkySvjV',
      name: 'Antoni',
      accent: 'American',
      vibe: 'Warm, encouraging',
      previewText:
        "I noticed you've been making great progress on this. Let's build on that momentum.",
    },
    {
      id: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      accent: 'American',
      vibe: 'Supportive, genuine',
      previewText: "You're closer than you think. What's one small step you could take right now?",
    },
    {
      id: 'pNInz6obpgDQGcFmaJgB',
      name: 'Adam',
      accent: 'American',
      vibe: 'Steady, motivating',
      previewText: "Let's reflect on what worked well this week and carry that forward.",
    },
    {
      id: 'onwK4e9ZLuTAKqWW03F9',
      name: 'Daniel',
      accent: 'British',
      vibe: 'Thoughtful, patient',
      previewText:
        "That's a really insightful observation. How does that connect to your bigger goal?",
    },
    {
      id: 'TxGEqnHWrfWFTfGW9XjX',
      name: 'Josh',
      accent: 'American',
      vibe: 'Calm, affirming',
      previewText: "Growth isn't always linear. You've handled tougher challenges than this.",
    },
    {
      id: 'VR6AewLTigWG4xSOukaG',
      name: 'Arnold',
      accent: 'American',
      vibe: 'Grounded, direct',
      previewText: "Here's what I see in your work — real, measurable progress.",
    },
  ],
  builder: [
    {
      id: 'pNInz6obpgDQGcFmaJgB',
      name: 'Adam',
      accent: 'American',
      vibe: 'Practical, energetic',
      previewText: "Let's break this down into buildable pieces and start shipping.",
    },
    {
      id: 'VR6AewLTigWG4xSOukaG',
      name: 'Arnold',
      accent: 'American',
      vibe: 'Direct, hands-on',
      previewText: "I drafted a working version. It's rough, but it runs. Let's iterate.",
    },
    {
      id: 'TxGEqnHWrfWFTfGW9XjX',
      name: 'Josh',
      accent: 'American',
      vibe: 'Focused, efficient',
      previewText: "Here's the fastest path to a working prototype. Three steps.",
    },
    {
      id: 'ErXwobaYiN019PkySvjV',
      name: 'Antoni',
      accent: 'American',
      vibe: 'Creative, fast-paced',
      previewText: "Don't overthink it — let's get something out the door and refine from there.",
    },
    {
      id: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      accent: 'American',
      vibe: 'Sharp, action-oriented',
      previewText: 'I scoped this out. We can ship the core feature by end of day.',
    },
    {
      id: 'onwK4e9ZLuTAKqWW03F9',
      name: 'Daniel',
      accent: 'British',
      vibe: 'Methodical, builder',
      previewText: "I've structured the components. Ready to wire them up when you are.",
    },
  ],
  connector: [
    {
      id: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      accent: 'American',
      vibe: 'Social, perceptive',
      previewText:
        'I see some interesting connections between what your team discussed and what marketing needs.',
    },
    {
      id: 'ErXwobaYiN019PkySvjV',
      name: 'Antoni',
      accent: 'American',
      vibe: 'Friendly, diplomatic',
      previewText:
        'I think looping in the design team early could save everyone a lot of back-and-forth.',
    },
    {
      id: 'onwK4e9ZLuTAKqWW03F9',
      name: 'Daniel',
      accent: 'British',
      vibe: 'Polished, relational',
      previewText:
        "There's someone in the network who's solved this exact problem. Want an introduction?",
    },
    {
      id: 'pNInz6obpgDQGcFmaJgB',
      name: 'Adam',
      accent: 'American',
      vibe: 'Warm, coordinating',
      previewText: "I've pulled together the key stakeholders. Here's who needs to be in the room.",
    },
    {
      id: 'TxGEqnHWrfWFTfGW9XjX',
      name: 'Josh',
      accent: 'American',
      vibe: 'Collaborative, clear',
      previewText: "Both teams are working toward the same goal — they just don't know it yet.",
    },
    {
      id: 'VR6AewLTigWG4xSOukaG',
      name: 'Arnold',
      accent: 'American',
      vibe: 'Bridging, steady',
      previewText: "I mapped out the overlapping interests. There's a win-win here.",
    },
  ],
  guardian: [
    {
      id: 'onwK4e9ZLuTAKqWW03F9',
      name: 'Daniel',
      accent: 'British',
      vibe: 'Careful, composed',
      previewText: 'Before we proceed, let me flag a few things that could become issues.',
    },
    {
      id: 'pNInz6obpgDQGcFmaJgB',
      name: 'Adam',
      accent: 'American',
      vibe: 'Reliable, watchful',
      previewText: "I've been tracking the deadlines. Two items need attention before Friday.",
    },
    {
      id: 'TxGEqnHWrfWFTfGW9XjX',
      name: 'Josh',
      accent: 'American',
      vibe: 'Calm, thorough',
      previewText: 'Everything is on track, but I want to double-check one dependency first.',
    },
    {
      id: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      accent: 'American',
      vibe: 'Alert, precise',
      previewText: "I caught something that slipped through. Here's what we need to fix.",
    },
    {
      id: 'VR6AewLTigWG4xSOukaG',
      name: 'Arnold',
      accent: 'American',
      vibe: 'Protective, measured',
      previewText: 'The risk here is manageable, but only if we address these two items now.',
    },
    {
      id: 'ErXwobaYiN019PkySvjV',
      name: 'Antoni',
      accent: 'American',
      vibe: 'Attentive, reassuring',
      previewText: "Nothing has fallen through the cracks. Here's your status update.",
    },
  ],
};

// Colors for avatar generation
const AVATAR_PALETTES: Record<string, string[]> = {
  strategist: ['#3B82F6', '#2563EB', '#1D4ED8'],
  analyst: ['#8B5CF6', '#7C3AED', '#6D28D9'],
  coach: ['#10B981', '#059669', '#047857'],
  builder: ['#F59E0B', '#D97706', '#B45309'],
  connector: ['#EC4899', '#DB2777', '#BE185D'],
  guardian: ['#6366F1', '#4F46E5', '#4338CA'],
};

// System prompt templates per archetype
const ARCHETYPE_PROMPTS: Record<string, string> = {
  strategist:
    'You are a strategic thinker who helps users plan, prioritize, and cut through noise. You are direct, data-informed, and action-oriented. You organize chaos into clear plans.',
  analyst:
    'You are a thorough analyst who researches, synthesizes, and finds patterns. You are precise, methodical, and insightful. You dig deep into data to surface what matters.',
  coach:
    'You are a supportive coach who motivates, reflects, and builds skills. You are warm, encouraging, and growth-oriented. You ask powerful questions and celebrate progress.',
  builder:
    'You are a pragmatic builder who creates, drafts, and ships. You are direct, fast-paced, and hands-on. You bias toward action and iterate quickly.',
  connector:
    'You are a natural connector who networks, manages relationships, and coordinates. You are social, empathetic, and people-aware. You know who to bring in and when.',
  guardian:
    'You are a meticulous guardian who tracks, reminds, and manages details. You are reliable, thorough, and calm. Nothing slips through the cracks on your watch.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AgentLeadWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (agentInfo: { id: string; name: string; archetype: string; color: string }) => void;
  /** Explicit workspace ID — falls back to workspace context if not provided */
  workspaceId?: string;
}

export function AgentLeadWizard({
  open,
  onClose,
  onComplete,
  workspaceId: explicitWorkspaceId,
}: AgentLeadWizardProps) {
  const { activeWorkspace } = useWorkspace();
  const { handlePlanLimitError } = usePlanLimitToast();
  const [step, setStep] = useState<Step>('name');
  const [agentName, setAgentName] = useState('');
  const [selectedArchetype, setSelectedArchetype] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [greetingText, setGreetingText] = useState<string | null>(null);
  const [customRole, setCustomRole] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [customColor, setCustomColor] = useState('#3DD68C');

  const workspaceId = explicitWorkspaceId ?? activeWorkspace?.id;

  const handlePreviewVoice = useCallback(
    async (voice: VoiceOption) => {
      if (playingVoice === voice.id) return;
      setPlayingVoice(voice.id);
      try {
        const res = await fetch(apiUrl('/api/voice/preview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: voice.id, text: voice.previewText }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const audio = new Audio(URL.createObjectURL(blob));
          audio.onended = () => setPlayingVoice(null);
          await audio.play();
        }
      } catch {
        toast.error('Voice preview failed');
      } finally {
        setTimeout(() => setPlayingVoice(null), 5000);
      }
    },
    [playingVoice],
  );

  const handleCreate = useCallback(async () => {
    const isFreeform = selectedArchetype === 'custom';
    if (!workspaceId || !agentName || (!selectedArchetype && !isFreeform)) return;
    setStep('creating');
    setCreating(true);

    try {
      const archetype = isFreeform ? null : ARCHETYPES.find((a) => a.id === selectedArchetype)!;
      const color = isFreeform
        ? customColor
        : (selectedColor ?? AVATAR_PALETTES[selectedArchetype!]?.[0] ?? '#6366F1');

      // Generate a slug from the display name + random suffix for uniqueness
      const slug = agentName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const suffix = Math.random().toString(36).slice(2, 6);
      const agentId = `${slug}-${suffix}`;

      // Voice settings to embed in agent config
      let voiceSettings = null;
      if (selectedVoice) {
        const voiceList = VOICE_OPTIONS[selectedArchetype] ?? VOICE_OPTIONS.strategist;
        const voice = voiceList.find((v) => v.id === selectedVoice);
        if (voice) {
          voiceSettings = {
            provider: 'elevenlabs',
            voice_id: voice.id,
            voice_name: voice.name,
            params: {
              stability: 0.75,
              similarity_boost: 0.85,
              style: 0.15,
              speed: 0.9,
              speaker_boost: true,
              model_id: 'eleven_multilingual_v2',
            },
          };
        }
      }

      // Create via POST /api/agents/configs (workspace-aware, enforces plan limits)
      const created = await fetchJson<{ id: string; agent_id: string }>(
        apiUrl('/api/agents/configs'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isFreeform
              ? {
                  workspace_id: workspaceId,
                  agent_id: agentId,
                  display_name: agentName,
                  role: customRole || 'Custom Agent',
                  description: customDescription || undefined,
                  agent_type: 'ai',
                  color,
                  persona_prompt:
                    customPrompt ||
                    `You are ${agentName}, a helpful AI agent. You are direct, capable, and adapt to the user's needs.`,
                  parameters: {
                    humor: 50,
                    honesty: 80,
                    directness: 70,
                    warmth: 50,
                    confidence: 70,
                    formality: 40,
                    verbosity: 50,
                    autonomy: 60,
                  },
                }
              : {
                  workspace_id: workspaceId,
                  agent_id: agentId,
                  display_name: agentName,
                  role: archetype!.name,
                  description: archetype!.tagline,
                  agent_type: 'ai',
                  color,
                  persona_prompt: ARCHETYPE_PROMPTS[selectedArchetype!],
                  parameters: {
                    humor: selectedArchetype === 'coach' ? 60 : 45,
                    honesty: 90,
                    directness: selectedArchetype === 'builder' ? 90 : 75,
                    warmth: selectedArchetype === 'coach' ? 85 : 60,
                    confidence: 80,
                    formality: selectedArchetype === 'analyst' ? 70 : 40,
                    verbosity: 50,
                    autonomy: selectedArchetype === 'guardian' ? 70 : 60,
                  },
                },
          ),
        },
      );

      const finalAgentId = created.agent_id ?? agentId;

      // Save voice settings if selected
      if (voiceSettings) {
        await fetchJson(apiUrl(`/api/agents/${finalAgentId}/voice`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(voiceSettings),
        }).catch(() => {
          // Voice save failure is non-fatal
        });
      }

      // Store the agent's first message as a memory
      const memoryContent = isFreeform
        ? `Custom agent "${agentName}" created with role "${customRole || 'Custom Agent'}".`
        : `Agent Lead "${agentName}" created with archetype "${archetype!.name}". Opening line: "${archetype!.openingLine}"`;
      await fetchJson(apiUrl('/api/memory/entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: `agent-lead:${finalAgentId}:first-message`,
          content: memoryContent,
          category: 'context',
          source: 'onboarding',
          workspace_id: workspaceId,
        }),
      }).catch(() => {
        // Memory save failure is non-fatal
      });

      // Show the "alive" moment
      setCreated(true);
      setGreetingText(isFreeform ? `Hi, I'm ${agentName}. Ready to help.` : archetype!.openingLine);

      // Play the opening line if voice was selected (fire-and-forget)
      const openingLine = isFreeform
        ? `Hi, I'm ${agentName}. Ready to help.`
        : archetype!.openingLine;
      if (selectedVoice) {
        fetch(apiUrl('/api/voice/preview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: selectedVoice, text: openingLine }),
        })
          .then((r) => (r.ok ? r.blob() : null))
          .then((blob) => {
            if (blob) {
              const audio = new Audio(URL.createObjectURL(blob));
              audio.play().catch(() => {
                /* Autoplay may be blocked by browser policy */
              });
            }
          })
          .catch(() => {
            /* Non-critical — greeting audio is optional */
          });
      }

      // Auto-close after a delay to let the greeting sink in
      setTimeout(() => {
        toast.success(`${agentName} is ready`);
        onComplete({ id: finalAgentId, name: agentName, archetype: selectedArchetype, color });
      }, 3000);
    } catch (e) {
      if (handlePlanLimitError(e)) {
        setStep('avatar');
        setCreating(false);
        return;
      }
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('429')) {
        toast.error('Agent limit reached. Upgrade your plan to create more agents.');
      } else {
        toast.error('Failed to create agent');
      }
      setStep('avatar');
      setCreating(false);
    }
  }, [
    workspaceId,
    agentName,
    selectedArchetype,
    selectedVoice,
    selectedColor,
    customRole,
    customDescription,
    customPrompt,
    customColor,
    onComplete,
    handlePlanLimitError,
  ]);

  const archetype = ARCHETYPES.find((a) => a.id === selectedArchetype);
  const voices = selectedArchetype
    ? (VOICE_OPTIONS[selectedArchetype] ?? VOICE_OPTIONS.strategist)
    : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !creating && onClose()}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <DialogTitle className="sr-only">Set up your AI agent</DialogTitle>
        {/* Step: Name */}
        {step === 'name' && (
          <div className="flex flex-col items-center px-8 py-12">
            <div
              className="bg-surface-200 mb-8 flex h-24 w-24 items-center justify-center rounded-full text-4xl opacity-40"
              style={{ opacity: agentName ? 1 : 0.4, transition: 'opacity 0.3s' }}
            >
              {agentName ? agentName.charAt(0).toUpperCase() : '?'}
            </div>
            <h2 className="text-foreground mb-2 text-xl font-semibold">
              What will you call your agent?
            </h2>
            <p className="text-muted-foreground mb-6 text-sm">This is yours. Make it meaningful.</p>
            <Input
              autoFocus
              placeholder="SAGE, NOVA, ECHO, ATLAS..."
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' && agentName.trim().length >= 2 && setStep('archetype')
              }
              className="text-center text-lg"
              maxLength={20}
            />
            <div className="mt-8 flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={agentName.trim().length < 2} onClick={() => setStep('archetype')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step: Archetype */}
        {step === 'archetype' && (
          <div className="px-6 py-8">
            <h2 className="text-foreground mb-1 text-lg font-semibold">
              Choose {agentName}&apos;s style
            </h2>
            <p className="text-muted-foreground mb-6 text-sm">
              This shapes how {agentName} thinks and communicates.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {/* Start from scratch option */}
              <button
                onClick={() => {
                  setSelectedArchetype('custom');
                  setStep('custom');
                }}
                className="border-border hover:border-brand/40 flex items-center gap-3 rounded-lg border border-dashed p-4 text-left transition-all hover:scale-[1.02]"
              >
                <div className="bg-surface-200 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                  <Plus className="text-foreground-lighter h-4 w-4" />
                </div>
                <div>
                  <span className="text-foreground text-xs font-bold tracking-wide">
                    START FROM SCRATCH
                  </span>
                  <p className="text-muted-foreground text-xs">Build a fully custom agent</p>
                </div>
              </button>
              {ARCHETYPES.map((a) => {
                const isSelected = selectedArchetype === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedArchetype(a.id)}
                    className={`rounded-lg border p-4 text-left transition-all hover:scale-[1.02] ${
                      isSelected
                        ? 'border-white/60 bg-white/5 ring-2 ring-white/20'
                        : 'border-border hover:border-white/30'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-lg">{a.icon}</span>
                      <span className="text-foreground text-xs font-bold tracking-wide">
                        {a.name}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">{a.tagline}</p>
                    {isSelected && (
                      <div className="mt-3 space-y-1.5">
                        {a.traits.map((t) => (
                          <div key={t.label} className="flex items-center gap-2">
                            <span className="text-muted-foreground w-16 text-[10px]">
                              {t.label}
                            </span>
                            <div className="bg-surface-300 h-1.5 flex-1 overflow-hidden rounded-full">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${t.value}%`, backgroundColor: a.color }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!isSelected && (
                      <p className="text-brand mt-2 text-xs italic">
                        &ldquo;{a.openingLine}&rdquo;
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="outline" onClick={() => setStep('name')}>
                Back
              </Button>
              <Button disabled={!selectedArchetype} onClick={() => setStep('voice')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step: Custom (freeform agent) */}
        {step === 'custom' && (
          <div className="px-6 py-8">
            <h2 className="text-foreground mb-1 text-lg font-semibold">
              Design {agentName} from scratch
            </h2>
            <p className="text-foreground-lighter mb-6 text-sm">
              Define what {agentName} does and how it behaves.
            </p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="custom-role" className="text-foreground text-xs font-medium">
                  Role
                </label>
                <Input
                  id="custom-role"
                  autoFocus
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  placeholder="e.g. Content Writer, Data Analyst, Project Manager"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="custom-description" className="text-foreground text-xs font-medium">
                  Description
                </label>
                <Textarea
                  id="custom-description"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="What does this agent do? What's it good at?"
                  rows={2}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="custom-prompt" className="text-foreground text-xs font-medium">
                    Persona Prompt{' '}
                    <span className="text-foreground-lighter font-normal">(optional)</span>
                  </label>
                  <span className="text-foreground-lighter text-xs">
                    {customPrompt.length}/2000
                  </span>
                </div>
                <Textarea
                  id="custom-prompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="System instructions that shape personality and behavior..."
                  rows={3}
                  maxLength={2000}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-foreground text-xs font-medium">Color</label>
                <div className="flex items-center gap-2">
                  {AGENT_COLOR_PRESETS_COMPACT.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCustomColor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition-transform ${
                        customColor === c
                          ? 'border-foreground scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                  <input
                    type="color"
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent"
                    aria-label="Custom color picker"
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedArchetype(null);
                  setStep('archetype');
                }}
              >
                Back
              </Button>
              <Button onClick={() => setStep('voice')}>Continue</Button>
            </div>
          </div>
        )}

        {/* Step: Voice */}
        {step === 'voice' && (
          <div className="px-6 py-8">
            <h2 className="text-foreground mb-1 text-lg font-semibold">
              Pick {agentName}&apos;s voice
            </h2>
            <p className="text-muted-foreground mb-6 text-sm">
              Preview how {agentName} sounds. Voice can be changed later.
            </p>
            <div className="space-y-2">
              {voices.map((v) => (
                <div
                  key={v.id}
                  role="option"
                  aria-selected={selectedVoice === v.id}
                  tabIndex={0}
                  onClick={() => setSelectedVoice(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedVoice(v.id);
                    }
                  }}
                  className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                    selectedVoice === v.id
                      ? 'border-white/60 bg-white/5 ring-2 ring-white/20'
                      : 'border-border hover:border-white/30'
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreviewVoice(v);
                    }}
                    aria-label={`Preview ${v.name} voice`}
                    className="bg-surface-200 hover:bg-surface-300 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors"
                  >
                    {playingVoice === v.id ? (
                      <Loader2 className="text-brand h-4 w-4 animate-spin" />
                    ) : (
                      <Volume2 className="text-muted-foreground h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground text-sm font-medium">{v.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {v.accent} · {v.vibe}
                    </div>
                  </div>
                  {selectedVoice === v.id && <Check className="text-brand h-4 w-4 flex-shrink-0" />}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <Button
                variant="outline"
                onClick={() => setStep(selectedArchetype === 'custom' ? 'custom' : 'archetype')}
              >
                Back
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelectedVoice(null);
                    if (selectedArchetype === 'custom') {
                      handleCreate();
                    } else {
                      setStep('avatar');
                    }
                  }}
                >
                  Skip
                </Button>
                <Button
                  disabled={!selectedVoice}
                  onClick={() => {
                    if (selectedArchetype === 'custom') {
                      handleCreate();
                    } else {
                      setStep('avatar');
                    }
                  }}
                >
                  {selectedArchetype === 'custom' ? `Create ${agentName}` : 'Continue'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step: Avatar */}
        {step === 'avatar' && archetype && (
          <div className="flex flex-col items-center px-8 py-10">
            <h2 className="text-foreground mb-6 text-lg font-semibold">
              Choose {agentName}&apos;s color
            </h2>
            <div className="mb-8 flex gap-4">
              {(AVATAR_PALETTES[selectedArchetype!] ?? AVATAR_PALETTES.strategist).map(
                (color, i) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    aria-label={`Color ${i + 1}: ${color}`}
                    className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white transition-all ${
                      selectedColor === color ? 'scale-110 ring-4 ring-white/50' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {agentName.slice(0, 2).toUpperCase()}
                  </button>
                ),
              )}
            </div>
            <p className="text-muted-foreground mb-8 text-sm">
              {archetype.icon} {archetype.name} · {archetype.tagline}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('voice')}>
                Back
              </Button>
              <Button onClick={handleCreate}>Create {agentName}</Button>
            </div>
          </div>
        )}

        {/* Step: Creating */}
        {step === 'creating' && (
          <div className="flex flex-col items-center px-8 py-16">
            <div
              className={`mb-6 flex h-24 w-24 items-center justify-center rounded-full text-2xl font-bold text-white transition-all duration-700 ${created ? 'scale-110' : 'animate-pulse'}`}
              style={{
                backgroundColor: selectedColor ?? customColor ?? archetype?.color ?? '#6366F1',
              }}
            >
              {agentName.slice(0, 2).toUpperCase()}
            </div>
            {!created ? (
              <>
                <Loader2 className="text-brand mb-4 h-6 w-6 animate-spin" />
                <p className="text-foreground font-medium">Setting up {agentName}...</p>
                <p className="text-muted-foreground mt-1 text-sm">This only takes a moment.</p>
              </>
            ) : (
              <>
                <Check className="text-brand mb-4 h-6 w-6" />
                <p className="text-foreground font-medium">{agentName} is alive</p>
                {greetingText && (
                  <p className="text-muted-foreground mt-3 max-w-xs text-center text-sm italic">
                    &ldquo;{greetingText}&rdquo;
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Progress dots */}
        {step !== 'creating' && (
          <div className="border-border flex items-center justify-center gap-1.5 border-t px-6 py-4">
            {(selectedArchetype === 'custom'
              ? (['name', 'custom', 'voice'] as Step[])
              : (['name', 'archetype', 'voice', 'avatar'] as Step[])
            ).map((s, i) => {
              const steps =
                selectedArchetype === 'custom'
                  ? ['name', 'custom', 'voice']
                  : ['name', 'archetype', 'voice', 'avatar'];
              const currentIdx = steps.indexOf(step);
              return (
                <span
                  key={s}
                  className={`rounded-full transition-all ${
                    i === currentIdx
                      ? 'bg-brand h-2 w-4'
                      : i < currentIdx
                        ? 'bg-brand/40 h-2 w-2'
                        : 'bg-surface-300 h-2 w-2'
                  }`}
                />
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
