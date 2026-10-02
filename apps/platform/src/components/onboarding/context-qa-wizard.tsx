'use client';

import { useState, useCallback } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent } from '@repo/ui/components/dialog';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlanLimitToast } from '@/hooks/use-plan-limit-toast';

// ---------------------------------------------------------------------------
// Question Definitions
// ---------------------------------------------------------------------------

interface QAQuestion {
  id: string;
  key: string;
  question: string;
  followUps: string[];
  category: 'context' | 'preference';
  memoryType: 'context' | 'preference';
  placeholder: string;
}

const TIER_1_QUESTIONS: QAQuestion[] = [
  {
    id: 'q1-role',
    key: 'role',
    question: 'What are you most responsible for right now?',
    followUps: ['Are you leading a team?', 'Are you building something new?'],
    category: 'context',
    memoryType: 'context',
    placeholder: 'e.g., Leading product development for a SaaS startup...',
  },
  {
    id: 'q2-priority',
    key: 'priority',
    question: "What's the biggest thing you're trying to move forward this month?",
    followUps: ['How long have you been working on this?'],
    category: 'context',
    memoryType: 'context',
    placeholder: 'e.g., Launching our beta to the first 100 users...',
  },
  {
    id: 'q3-autonomy',
    key: 'autonomy',
    question:
      'How do you prefer to work — do you want me to just handle things, or would you rather I bring you options and you decide?',
    followUps: [],
    category: 'preference',
    memoryType: 'preference',
    placeholder: '',
  },
];

const AUTONOMY_OPTIONS = [
  { label: 'Just handle it', value: 'autonomous', description: 'Take action and keep me posted' },
  {
    label: 'Give me options',
    value: 'advisory',
    description: "Research and recommend, I'll decide",
  },
  { label: 'Check with me', value: 'collaborative', description: 'Check on anything important' },
];

// Archetype-specific framing for each question
function getAgentFraming(archetype: string, agentName: string, questionIndex: number): string {
  const frames: Record<string, string[]> = {
    strategist: [
      `Before I can help you prioritize, I need to understand what's on your plate.`,
      `Good. Now — what's the one thing that would make the biggest difference if it moved forward?`,
      `Last question. This one shapes how we work together.`,
    ],
    analyst: [
      `I need some data points to be useful. Let's start with the basics.`,
      `Interesting. Now, what's the main challenge you're investigating right now?`,
      `One more — this determines how I present my findings.`,
    ],
    coach: [
      `I'd love to understand where you're at right now.`,
      `That's great context. What's the goal that feels most alive for you this month?`,
      `Last one — this helps me calibrate how much I push vs. support.`,
    ],
    builder: [
      `Let's get right to it. What's your current focus?`,
      `Cool. What's the thing you most want to ship or finish?`,
      `Final question — how hands-on do you want me to be?`,
    ],
    connector: [
      `To help you manage relationships and coordination, I need to understand your role.`,
      `Got it. What's the biggest initiative you're coordinating right now?`,
      `Last one — how involved do you want me to be in your day-to-day?`,
    ],
    guardian: [
      `I keep things from falling through the cracks. To do that, I need to understand what you're tracking.`,
      `Noted. What's the most critical thing that needs your attention this month?`,
      `Final question — this determines how proactive I'll be.`,
    ],
  };
  const archetypeFrames = frames[archetype] ?? frames.strategist;
  return archetypeFrames[questionIndex] ?? '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContextQAWizardProps {
  open: boolean;
  agentId: string;
  agentName: string;
  archetype: string;
  agentColor: string;
  onClose: () => void;
  onComplete: () => void;
}

export function ContextQAWizard({
  open,
  agentId,
  agentName,
  archetype,
  agentColor,
  onClose,
  onComplete,
}: ContextQAWizardProps) {
  const { activeWorkspace } = useWorkspace();
  const { handlePlanLimitError } = usePlanLimitToast();
  const [currentQ, setCurrentQ] = useState(0);
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const workspaceId = activeWorkspace?.id;
  const question = TIER_1_QUESTIONS[currentQ];
  const isAutonomyQ = question?.id === 'q3-autonomy';
  const initials = agentName.slice(0, 2).toUpperCase();

  const storeAnswer = useCallback(
    async (questionDef: QAQuestion, answerText: string) => {
      if (!workspaceId) return;
      try {
        await fetchJson(apiUrl('/api/memory/entries'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: `context-qa:${agentId}:${questionDef.id}`,
            content: `Q: ${questionDef.question}\nA: ${answerText}`,
            category: questionDef.category,
            memory_type: questionDef.memoryType,
            source: 'context-qa',
            workspace_id: workspaceId,
            agent_id: agentId,
            importance_score: 80,
            tags: `onboarding,${questionDef.key}`,
          }),
        });
      } catch (err) {
        if (!handlePlanLimitError(err)) {
          toast.error('Failed to save answer — continuing anyway');
        }
      }
    },
    [workspaceId, agentId, handlePlanLimitError],
  );

  const handleSubmit = useCallback(async () => {
    if (!question) return;
    const finalAnswer = answer.trim();
    if (!finalAnswer) return;

    setSaving(true);
    await storeAnswer(question, finalAnswer);

    const newAnswers = { ...answers, [question.id]: finalAnswer };
    setAnswers(newAnswers);
    setAnswer('');

    if (currentQ < TIER_1_QUESTIONS.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      // All questions answered — store autonomy preference as a separate setting
      toast.success(`${agentName} is ready to work with you`);
      onComplete();
    }
    setSaving(false);
  }, [answer, answers, currentQ, question, storeAnswer, agentName, onComplete]);

  const handleAutonomySelect = useCallback(
    async (value: string, label: string) => {
      if (!question) return;
      setSaving(true);
      await storeAnswer(question, `${label} (${value})`);
      setAnswers({ ...answers, [question.id]: value });
      toast.success(`${agentName} is ready to work with you`);
      onComplete();
      setSaving(false);
    },
    [question, storeAnswer, answers, agentName, onComplete],
  );

  if (!question) return null;

  const framing = getAgentFraming(archetype, agentName, currentQ);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <div className="flex flex-col">
          {/* Agent message area */}
          <div className="space-y-4 px-6 pt-8 pb-4">
            {/* Agent bubble */}
            <div className="flex items-start gap-3">
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: agentColor }}
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground mb-0.5 text-xs font-semibold">{agentName}</p>
                <div className="bg-surface-100 rounded-lg rounded-tl-none px-4 py-3">
                  <p className="text-muted-foreground mb-2 text-sm">{framing}</p>
                  <p className="text-foreground text-sm font-medium">{question.question}</p>
                </div>
              </div>
            </div>

            {/* Previous answers as user bubbles */}
            {currentQ > 0 && (
              <div className="text-muted-foreground border-border border-t pt-3 text-xs">
                {currentQ} of {TIER_1_QUESTIONS.length} answered
              </div>
            )}
          </div>

          {/* Answer input area */}
          <div className="border-border border-t px-6 py-4">
            {isAutonomyQ ? (
              <div className="space-y-2">
                {AUTONOMY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    disabled={saving}
                    onClick={() => handleAutonomySelect(opt.value, opt.label)}
                    className="border-border hover:border-brand/40 hover:bg-brand/5 flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-sm font-medium">{opt.label}</div>
                      <div className="text-muted-foreground text-xs">{opt.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2">
                <textarea
                  autoFocus
                  rows={2}
                  className="bg-surface-100 border-border text-foreground placeholder:text-muted-foreground w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/30 focus:outline-none"
                  placeholder={question.placeholder}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && answer.trim()) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={saving || !answer.trim()}
                  onClick={handleSubmit}
                  className="self-end"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Progress dots */}
          <div className="border-border flex items-center justify-center gap-1.5 border-t px-6 py-3">
            {TIER_1_QUESTIONS.map((_, i) => (
              <span
                key={i}
                className={`rounded-full transition-all ${
                  i === currentQ
                    ? 'bg-brand h-2 w-4'
                    : i < currentQ
                      ? 'bg-brand/40 h-2 w-2'
                      : 'bg-surface-300 h-2 w-2'
                }`}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
