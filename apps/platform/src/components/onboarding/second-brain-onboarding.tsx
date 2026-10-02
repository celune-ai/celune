'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { AgentLeadWizard } from './agent-lead-wizard';
import { ContextQAWizard } from './context-qa-wizard';
import { GenerationLoading } from './generation-loading';
import { KnowledgeStep } from './knowledge-step';
// PostGenerationDashboard is no longer shown — the user is redirected to their
// workspace dashboard immediately, with a seeding banner if content is still loading.

// ---------------------------------------------------------------------------
// Flow phases
// ---------------------------------------------------------------------------

type Phase = 'agent-lead' | 'knowledge' | 'context-qa' | 'generating' | 'done';

interface AgentInfo {
  id: string;
  name: string;
  archetype: string;
  color: string;
}

// Map archetype → color (matches agent-lead-wizard.tsx AVATAR_PALETTES defaults)
const ARCHETYPE_COLORS: Record<string, string> = {
  strategist: '#3B82F6',
  analyst: '#8B5CF6',
  coach: '#10B981',
  builder: '#F59E0B',
  connector: '#EC4899',
  guardian: '#6366F1',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SecondBrainOnboardingProps {
  open: boolean;
  onClose: () => void;
}

export function SecondBrainOnboarding({ open, onClose }: SecondBrainOnboardingProps) {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const [phase, setPhase] = useState<Phase>('agent-lead');
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [generationResult, setGenerationResult] = useState<{
    learning_project_id?: string;
    goal_project_id?: string;
    goal_project_name: string;
    task_count?: number;
    seeding_status?: string;
  } | null>(null);
  const [generationDone, setGenerationDone] = useState(false);

  const workspaceId = activeWorkspace?.id;

  // Phase 1 complete: Agent Lead created
  const handleAgentCreated = useCallback(
    (agentInfo: { id: string; name: string; archetype: string; color: string }) => {
      setAgent({
        id: agentInfo.id,
        name: agentInfo.name,
        archetype: agentInfo.archetype,
        color: agentInfo.color,
      });
      setPhase('knowledge');
    },
    [],
  );

  // Phase 2 complete: Context Q&A finished
  const handleQAComplete = useCallback(async () => {
    setPhase('generating');
    setGenerationDone(false);

    // Trigger project generation (now returns immediately — seeding happens in background)
    // Enforce a minimum 2s animation time so the loading screen isn't jarring.
    try {
      const [result] = await Promise.all([
        fetchJson<{
          workspace_id: string;
          goal_project_name: string;
          seeding_status: string;
        }>(apiUrl('/api/onboarding/generate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            agent_id: agent?.id,
          }),
        }),
        new Promise((resolve) => setTimeout(resolve, 2000)), // minimum animation time
      ]);

      // Signal loading component that API is done so it can fast-forward steps
      setGenerationDone(true);
      setGenerationResult({
        goal_project_name: result.goal_project_name || 'Your Goal Project',
        seeding_status: result.seeding_status,
      });
      // Phase transition to 'dashboard' happens via onStepsFinished callback
    } catch {
      toast.error('Failed to generate starter projects');
      setPhase('done');
      onClose();
    }
  }, [workspaceId, agent, onClose]);

  // Called by GenerationLoading after it finishes fast-forwarding all steps.
  // Now redirects directly to the workspace dashboard — projects are seeding
  // in the background and the dashboard shows a seeding indicator.
  const handleStepsFinished = useCallback(() => {
    if (generationResult) {
      setPhase('done');
      onClose();
      // Navigate to workspace dashboard where the seeding banner will show
      router.push(workspaceHref('/'));
    }
  }, [generationResult, onClose, router, workspaceHref]);

  const handleClose = useCallback(() => {
    setPhase('done');
    onClose();
  }, [onClose]);

  if (!open || phase === 'done') return null;

  return (
    <>
      {phase === 'agent-lead' && (
        <AgentLeadWizard open onClose={handleClose} onComplete={handleAgentCreated} />
      )}

      {phase === 'knowledge' && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-surface-75 w-full max-w-lg rounded-xl border py-8 shadow-xl">
            <KnowledgeStep
              onComplete={() => setPhase('context-qa')}
              onSkip={() => setPhase('context-qa')}
            />
          </div>
        </div>
      )}

      {phase === 'context-qa' && agent && (
        <ContextQAWizard
          open
          agentId={agent.id}
          agentName={agent.name}
          archetype={agent.archetype}
          agentColor={agent.color}
          onClose={handleClose}
          onComplete={handleQAComplete}
        />
      )}

      {phase === 'generating' && agent && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-surface-75 w-full max-w-md rounded-xl border shadow-xl">
            <GenerationLoading
              agentName={agent.name}
              agentColor={agent.color}
              isComplete={generationDone}
              onStepsFinished={handleStepsFinished}
            />
          </div>
        </div>
      )}
    </>
  );
}
