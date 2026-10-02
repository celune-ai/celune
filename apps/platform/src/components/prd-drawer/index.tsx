'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import {
  X,
  Calendar,
  User,
  Bot,
  Hash,
  ListChecks,
  CircleDot,
  ShieldCheck,
  Wand2,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@repo/ui/utils';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';
import { usePlanLimitToast } from '@/hooks/use-plan-limit-toast';
import type { Project, PrdMetadata } from '@repo/types';
import { getProjectDocLabel } from '@repo/types';
import { PrdDrawerBody } from './prd-drawer-body';

const PRD_TEMPLATE = `## Problem Statement
What problem does this project solve? Who is affected?

## Research & Discovery
> *Completed by SAGE (PM) + DELV (Research)*

### User Insights
- What do users experience today?
- What pain points or unmet needs exist?

### Competitive Landscape
- How do others solve this? What can we learn?

### Technical Landscape
- What constraints exist? What's already built that we can leverage?

## Goals
- Goal 1
- Goal 2

## Non-Goals
- What is explicitly out of scope

## Requirements
> *Reviewed by NOIR (Design) + SCAN (Code Review)*

### Functional
- Requirement 1
- Requirement 2

### Non-Functional
- Performance, security, or other constraints

### User Stories
- As a [user], I want [capability] so that [outcome]

## Design Direction
> *Contributed by NOIR (Design)*

Key UX decisions, interaction patterns, and design constraints.

## Technical Approach
> *Contributed by RICK (Engineering)*

High-level architecture, key technical decisions, and trade-offs considered.

## Open Questions & Decisions
| Question | Owner | Resolution |
|----------|-------|------------|
| Example question | SAGE | Pending |

## Success Metrics
How will we know this project succeeded?
`;

const BRIEF_TEMPLATE = `## Overview
What is this project about? What will it accomplish?

## Goals
- Goal 1
- Goal 2

## Key Tasks & Sequencing
Overview of the tasks and the order they should be tackled.

## Requirements
- What needs to be true for this project to succeed?
- Key constraints, deadlines, or dependencies

## Expected Outcomes
What does "done" look like? What will be delivered?

## Open Questions
| Question | Owner | Status |
|----------|-------|--------|
| Example question | — | Open |
`;

export interface PrdDrawerProps {
  open: boolean;
  project: Project | null;
  taskCount: number;
  initialEditMode?: boolean;
  onClose: () => void;
  onSaved: (project: Project) => void;
}

export function PrdDrawer({
  open,
  project,
  taskCount,
  initialEditMode = false,
  onClose,
  onSaved,
}: PrdDrawerProps) {
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState<PrdMetadata | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { activeWorkspace } = useWorkspace();
  const { handlePlanLimitError } = usePlanLimitToast();

  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showStickyDivider, setShowStickyDivider] = useState(false);

  // IntersectionObserver for sticky divider
  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyDivider(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open]);

  // Sync drawer state from project data
  const syncFromProject = useCallback(
    (p: Project) => {
      if (initialEditMode && !p.prd_content?.trim()) {
        const { shortLabel } = getProjectDocLabel(p.project_type, p.category);
        setContent(shortLabel === 'Brief' ? BRIEF_TEMPLATE : PRD_TEMPLATE);
        setMetadata({
          author: 'eric',
          status: 'draft',
          agents_involved: [],
          created_date: new Date().toISOString().split('T')[0],
        });
        setEditing(true);
      } else {
        setContent(p.prd_content ?? '');
        const raw = p.prd_metadata;
        let parsed: PrdMetadata | null = null;
        if (typeof raw === 'string') {
          try {
            parsed = JSON.parse(raw);
          } catch {
            /* malformed metadata — skip */
          }
        } else {
          parsed = raw ?? null;
        }
        // Backfill required fields for metadata written outside the UI
        if (parsed && (!parsed.author || !parsed.agents_involved || !parsed.created_date)) {
          setMetadata({
            author: parsed.author ?? 'unknown',
            status: parsed.status ?? 'draft',
            agents_involved: parsed.agents_involved ?? [],
            created_date: parsed.created_date ?? new Date().toISOString().split('T')[0],
            reviewed_by: parsed.reviewed_by,
            review_date: parsed.review_date,
          });
        } else {
          setMetadata(parsed);
        }
        setEditing(false);
      }
    },
    [initialEditMode],
  );

  // Sync when project data changes
  useEffect(() => {
    if (!project || !open) return;
    syncFromProject(project);
  }, [project, syncFromProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync when drawer opens (picks up external changes)
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open && !prevOpen.current && project) {
      syncFromProject(project);
    }
    prevOpen.current = open;
  }, [open, project, syncFromProject]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const requirementCount = (content.match(/^## /gm) ?? []).length;
  const { label: docLabel, shortLabel: docShort } = getProjectDocLabel(
    project?.project_type,
    project?.category,
  );

  const handleGenerate = async () => {
    if (!project) return;
    setGenerating(true);
    try {
      // Create the PRD task
      const task = await fetchJson<{ id: string }>(apiUrl('/api/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Create a PRD',
          description: `## What\nProduce a Product Requirements Document for "${project.name}" through collaborative R&D.\n\n## Approach\n1. **SAGE + DELV draft**: Research the problem space, synthesize into structured PRD.\n2. **NOIR + SCAN review**: Design reviews UX, Code Reviewer flags concerns.\n3. **Merge feedback**: Incorporate all reviewer input.\n4. **Upload PRD**: Save to project via API.\n\n## Blockers\nNone — agents can start immediately.`,
          priority: 'high',
          status: 'inbox',
          assignee: 'sage',
          project_id: project.id,
          workspace_id: activeWorkspace?.id ?? null,
          metadata: { sprint: 0 },
        }),
      });
      // Initiate it so the R&D team picks it up
      await fetch(apiUrl(`/api/tasks/${task.id}/initiate`), { method: 'POST' });
      toast.success(`${docShort} task created and assigned to R&D team`);
    } catch (err) {
      if (!handlePlanLimitError(err)) {
        console.error(`Failed to generate ${docShort} task:`, err);
        toast.error(`Failed to create ${docShort} task`);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const saved = await fetchJson<Project>(
        apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace?.id}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prd_content: content.trim() || null,
            prd_metadata: metadata,
          }),
        },
      );
      onSaved(saved);
      setEditing(false);
      toast.success(`${docShort} saved`);
    } catch (err) {
      console.error(`Failed to save ${docShort}:`, err);
      toast.error(`Failed to save ${docShort}`);
    } finally {
      setSaving(false);
    }
  };

  const statusColor: Record<string, string> = {
    draft: '',
    review: '',
    approved: '',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={project ? `${docShort}: ${project.name}` : docShort}
        className={cn(
          'border-border bg-surface-75 fixed top-0 right-0 z-[61] flex h-full w-2/5 min-w-[400px] flex-col border-l shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-foreground text-lg font-semibold">{docLabel}</h2>
          <div className="flex items-center gap-2">
            {!content.trim() && (
              <Button size="md" variant="outline" onClick={handleGenerate} disabled={generating}>
                {generating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                {generating ? 'Generating...' : `Generate ${docShort}`}
              </Button>
            )}
            <TooltipProvider delayDuration={500}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="text-foreground-muted hover:text-foreground rounded-md p-1 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Close
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Metadata chips */}
        {metadata && (
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            <Badge variant="muted">
              <CircleDot className="mr-1 h-3 w-3" />
              {metadata.status}
            </Badge>
            <Badge variant="muted">
              <Calendar className="mr-1 h-3 w-3" />
              {metadata.created_date}
            </Badge>
            <Badge variant="muted">
              <User className="mr-1 h-3 w-3" />
              {metadata.author}
            </Badge>
            {metadata.agents_involved?.length > 0 && (
              <Badge variant="muted">
                <Bot className="mr-1 h-3 w-3" />
                {metadata.agents_involved.join(', ')}
              </Badge>
            )}
            {metadata.reviewed_by && metadata.reviewed_by.length > 0 && (
              <Badge variant="muted">
                <ShieldCheck className="mr-1 h-3 w-3" />
                Reviewed by {metadata.reviewed_by.join(', ')}
              </Badge>
            )}
            <Badge variant="muted">
              <Hash className="mr-1 h-3 w-3" />
              {requirementCount} sections
            </Badge>
            <Badge variant="muted">
              <ListChecks className="mr-1 h-3 w-3" />
              {taskCount} tasks
            </Badge>
          </div>
        )}

        {/* Sticky divider */}
        <div
          className={cn(
            'border-border border-b transition-opacity duration-150',
            showStickyDivider ? 'opacity-100' : 'opacity-0',
          )}
        />

        {/* Scrollable body */}
        <div className="flex flex-1 flex-col overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
          <div ref={sentinelRef} className="h-0 w-full" />
          <div className="border-border mx-5 border-t pt-4" />
          <PrdDrawerBody
            content={content}
            onContentChange={setContent}
            editing={editing}
            onEditingChange={setEditing}
            docShort={docShort}
          />
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : `Save ${docShort}`}
          </Button>
        </div>
      </div>
    </>
  );
}
