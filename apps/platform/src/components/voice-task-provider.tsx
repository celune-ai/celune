'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { apiUrl } from '@repo/db/api';
import { MicButton } from './mic-button';
import { VoiceTaskModal } from './voice-task-modal';
import { useWorkspace } from '@/providers/workspace-provider';
import type { VoiceParseResult } from '@/app/api/voice/parse/route';

interface VoiceTaskContextValue {
  /** Whether voice task is currently processing */
  isProcessing: boolean;
}

const VoiceTaskContext = createContext<VoiceTaskContextValue>({ isProcessing: false });

export function useVoiceTask() {
  return useContext(VoiceTaskContext);
}

export function VoiceTaskProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [processing, setProcessing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [parseResult, setParseResult] = useState<VoiceParseResult | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const { activeWorkspace, workspaces } = useWorkspace();

  // Fetch projects for the project picker
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    fetch(apiUrl(`/api/projects?workspace_id=${activeWorkspace.id}`))
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProjects(data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
        }
      })
      .catch(() => {
        /* Non-critical — voice task picker works without project list */
      });
  }, [activeWorkspace?.id]);

  // Detect current project from URL
  const currentProjectId = pathname.match(/\/projects\/([0-9a-f-]{36})/)?.[1] ?? undefined;
  const currentProjectName = currentProjectId
    ? projects.find((p) => p.id === currentProjectId)?.name
    : undefined;

  const handleTranscript = useCallback(
    async (transcript: string) => {
      setProcessing(true);
      try {
        const res = await fetch(apiUrl('/api/voice/parse'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            context: {
              currentProjectId,
              currentProjectName,
              existingProjects: projects,
              currentWorkspaceSlug: activeWorkspace?.slug,
              availableWorkspaces: workspaces.map((w) => ({ slug: w.slug, name: w.name })),
            },
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Parse failed' }));
          toast.error(err.error || 'Voice parse failed');
          return;
        }

        const result = (await res.json()) as VoiceParseResult;
        setParseResult(result);

        if (result.intent === 'none') {
          toast.info(result.message || 'No actionable content detected');
        } else {
          setModalOpen(true);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Voice parse failed');
      } finally {
        setProcessing(false);
      }
    },
    [currentProjectId, currentProjectName, projects, activeWorkspace, workspaces],
  );

  const handleComplete = useCallback(() => {
    setParseResult(null);
  }, []);

  return (
    <VoiceTaskContext.Provider value={{ isProcessing: processing }}>
      {children}

      {/* Fixed mic button — bottom right */}
      <div className="fixed right-6 bottom-6 z-50">
        <MicButton onTranscript={handleTranscript} processing={processing} />
      </div>

      {/* Confirmation modal */}
      <VoiceTaskModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        parseResult={parseResult}
        projects={projects}
        onComplete={handleComplete}
      />
    </VoiceTaskContext.Provider>
  );
}
