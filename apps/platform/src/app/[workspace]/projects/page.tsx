'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Filter,
  FolderOpen,
  GripVertical,
  Mic,
  PenLine,
  Plus,
  SortAsc,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { ProjectTable } from '@celuneai/react/projects';
import { PageActionBar } from '@/components/page-action-bar';
import { PageTabs } from '@/components/page-tabs';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@repo/ui/components/dialog';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { toast } from 'sonner';
import { toastWithUndo } from '@celuneai/react/utils';
import type { Project, ProjectGroup, ProjectType } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { createClient } from '@repo/db/client';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';
import { useWorkspace } from '@/providers/workspace-provider';
import { useCanEdit } from '@/hooks/use-can-edit';
import { PermissionGate } from '@/components/permission-gate';
import { GroupBranchInfo } from '@/components/group-branch-info';

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'feature', label: 'Features' },
  { id: 'system', label: 'System' },
  { id: 'research', label: 'Research' },
  { id: 'plan', label: 'Plans' },
] as const;

const SORT_MODES = [
  { id: 'manual', label: 'Manual', icon: GripVertical },
  { id: 'name', label: 'Name', icon: SortAsc },
  { id: 'created', label: 'Newest', icon: Clock },
  { id: 'progress', label: 'Progress', icon: TrendingUp },
] as const;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [taskCounts, setTaskCounts] = useState<
    Record<string, { taskCount: number; doneCount: number; hasActiveTask: boolean }>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createType, setCreateType] = useState<ProjectType>('feature');
  const [createGroupId, setCreateGroupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTypeFilter, setActiveTypeFilter] = useState('all');
  const [activeGroup, setActiveGroup] = useState('all'); // 'all' | 'ungrouped' | group id
  const [hideCompleted, setHideCompleted] = useState(true);
  const [splitOpen, setSplitOpen] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'manual' | 'name' | 'created' | 'progress'>('manual');
  const [dialogMode, setDialogMode] = useState<'manual' | 'voice'>('manual');
  const [voiceListening, setVoiceListening] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  // Voice input for project creation
  const handleVoiceTranscript = useCallback((text: string) => {
    setName(text.trim());
    setDialogMode('manual');
    setVoiceListening(false);
  }, []);

  const speech = useSpeechRecognition({
    onFinalTranscript: handleVoiceTranscript,
  });

  const { activeWorkspace } = useWorkspace();
  const canEdit = useCanEdit();

  const fetchData = useCallback(() => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    setError(null);
    const wsParam = `?workspace_id=${activeWorkspace.id}`;
    const countsParam = '&include_counts=true';
    Promise.all([
      fetchJson<{
        projects: Project[];
        taskCounts: Record<
          string,
          { taskCount: number; doneCount: number; hasActiveTask: boolean }
        >;
      }>(apiUrl(`/api/projects${wsParam}${countsParam}`)),
      fetchJson<ProjectGroup[]>(apiUrl(`/api/project-groups${wsParam}`)).catch(
        () => [] as ProjectGroup[],
      ),
    ])
      .then(([projectsData, g]) => {
        setProjects(projectsData.projects);
        setTaskCounts(projectsData.taskCounts);
        setGroups(g);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load projects';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchData();

    // Refetch when tab becomes visible (covers CLI/API changes)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Subscribe to Supabase Realtime for live task updates
    const supabase = createClient();
    const channel = supabase
      .channel('projects-tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/projects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          project_type: createType,
          group_id: createGroupId,
          workspace_id: activeWorkspace?.id ?? null,
        }),
      });
      const project = await res.json();
      setProjects((prev) => [project, ...prev]);
      setName('');
      setDescription('');
      setCreateType('feature');
      setCreateGroupId(null);
      setDialogOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  // Task counts are now computed server-side and returned with the projects response
  const projectCounts = taskCounts;

  const visibleProjects = useMemo(() => {
    if (!hideCompleted) return projects;
    return projects.filter((p) => p.status !== 'completed');
  }, [projects, hideCompleted]);

  const groupFilteredProjects = useMemo(() => {
    if (activeGroup === 'all') return visibleProjects.filter((p) => !p.group_id);
    return visibleProjects.filter((p) => p.group_id === activeGroup);
  }, [visibleProjects, activeGroup]);

  const filteredProjects = useMemo(() => {
    if (activeTypeFilter === 'all') return groupFilteredProjects;
    return groupFilteredProjects.filter((p) => (p.project_type ?? 'feature') === activeTypeFilter);
  }, [groupFilteredProjects, activeTypeFilter]);

  const sortedProjects = useMemo(() => {
    if (sortBy === 'manual') return filteredProjects;
    return [...filteredProjects].sort((a, b) => {
      if (sortBy === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
      if (sortBy === 'created')
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'progress') {
        const aCount = projectCounts[a.id];
        const bCount = projectCounts[b.id];
        const aPct = aCount && aCount.taskCount > 0 ? aCount.doneCount / aCount.taskCount : 0;
        const bPct = bCount && bCount.taskCount > 0 ? bCount.doneCount / bCount.taskCount : 0;
        return bPct - aPct;
      }
      return 0;
    });
  }, [filteredProjects, sortBy, projectCounts]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      feature: 0,
      system: 0,
      research: 0,
      plan: 0,
    };
    for (const p of groupFilteredProjects) {
      const type = p.project_type ?? 'feature';
      counts[type] = (counts[type] ?? 0) + 1;
    }
    counts.all = groupFilteredProjects.length;
    return counts;
  }, [groupFilteredProjects]);

  const groupTabs = useMemo(() => {
    return [
      { id: 'all', label: `Unassigned (${visibleProjects.filter((p) => !p.group_id).length})` },
      ...groups.map((g) => {
        const count = visibleProjects.filter((p) => p.group_id === g.id).length;
        return { id: g.id, label: `${g.name} (${count})` };
      }),
    ];
  }, [groups, visibleProjects]);

  const groupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) map[g.id] = g.name;
    return map;
  }, [groups]);

  // --- Shared DnD for table reorder + tab drop-to-group ---
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dragSnapshot, setDragSnapshot] = useState<Project[] | null>(null);
  const sortedProjectsRef = useRef(sortedProjects);
  sortedProjectsRef.current = sortedProjects;

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(event.active.id as string);
    setDragSnapshot([...sortedProjectsRef.current]);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setDragActiveId(null);

      if (!over) {
        setDragSnapshot(null);
        return;
      }

      const overId = over.id as string;

      // --- Drop onto a tab → change group_id ---
      if (overId.startsWith('tab:')) {
        const tabId = overId.slice(4); // strip "tab:" prefix
        const project = projects.find((p) => p.id === active.id);
        if (!project) {
          setDragSnapshot(null);
          return;
        }

        const newGroupId = tabId === 'all' ? null : tabId;
        // Skip if already in this group
        if ((project.group_id ?? 'all') === (newGroupId ?? 'all')) {
          setDragSnapshot(null);
          return;
        }

        // Optimistic update
        setProjects((prev) =>
          prev.map((p) => (p.id === project.id ? { ...p, group_id: newGroupId } : p)),
        );

        try {
          const res = await fetch(
            apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace?.id}`),
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ group_id: newGroupId }),
            },
          );
          if (!res.ok) throw new Error('Failed to update group');
          const updated: Project = await res.json();
          setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          const groupName = newGroupId
            ? (groups.find((g) => g.id === newGroupId)?.name ?? 'group')
            : 'ungrouped';
          toast.success(`Moved to ${groupName}`);
        } catch {
          // Rollback
          setProjects((prev) =>
            prev.map((p) => (p.id === project.id ? { ...p, group_id: project.group_id } : p)),
          );
          toast.error('Failed to move project');
        }

        setDragSnapshot(null);
        return;
      }

      // --- Drop onto another row → reorder ---
      if (active.id === over.id) {
        setDragSnapshot(null);
        return;
      }

      const oldIndex = sortedProjectsRef.current.findIndex((p) => p.id === active.id);
      const newIndex = sortedProjectsRef.current.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        setDragSnapshot(null);
        return;
      }

      const reordered = arrayMove(sortedProjectsRef.current, oldIndex, newIndex);
      const payload = reordered.map((p, idx) => ({
        id: p.id,
        sort_order: (idx + 1) * 1000,
      }));

      const withSortOrder = reordered.map((p, idx) => ({
        ...p,
        sort_order: (idx + 1) * 1000,
      }));
      handleReorder(withSortOrder);

      try {
        const res = await fetch(apiUrl('/api/projects/reorder'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Reorder failed');
      } catch {
        if (dragSnapshot) handleReorder(dragSnapshot);
      }

      setDragSnapshot(null);
    },
    [projects, groups, dragSnapshot],
  );

  const handleReorder = useCallback((reordered: Project[]) => {
    setProjects((prev) => {
      // Merge reordered sort_orders into the full project list
      const map = new Map(reordered.map((p) => [p.id, p]));
      return prev
        .map((p) => map.get(p.id) ?? p)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    });
  }, []);

  const handleToggleComplete = useCallback(
    async (project: Project) => {
      if (!activeWorkspace?.id) {
        toast.error('Workspace not loaded yet — try again in a moment');
        return;
      }
      const newStatus = project.status === 'completed' ? 'active' : 'completed';
      // Optimistic update
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, status: newStatus } : p)),
      );
      try {
        const res = await fetch(
          apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace.id}`),
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          },
        );
        if (!res.ok) throw new Error('Failed to update project status');
        const updated: Project = await res.json();
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        toast.success(newStatus === 'completed' ? 'Project completed' : 'Project reopened');
      } catch {
        // Rollback
        setProjects((prev) =>
          prev.map((p) => (p.id === project.id ? { ...p, status: project.status } : p)),
        );
        toast.error('Failed to update project status');
      }
    },
    [activeWorkspace?.id],
  );

  const handleDeleteProject = useCallback(
    async (project: Project) => {
      if (!activeWorkspace?.id) {
        toast.error('Workspace not loaded yet — try again in a moment');
        return;
      }
      // Optimistic removal
      setProjects((prev) => prev.filter((p) => p.id !== project.id));

      toastWithUndo(`"${project.name}" deleted`, {
        action: async () => {
          const res = await fetch(
            apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace.id}`),
            { method: 'DELETE' },
          );
          if (!res.ok) throw new Error('Failed to delete project');
        },
        onUndo: () => {
          setProjects((prev) =>
            [...prev, project].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
          );
        },
        undoMessage: `"${project.name}" restored`,
        errorMessage: 'Failed to delete project',
      });
    },
    [activeWorkspace?.id],
  );

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/project-groups'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || null }),
      });
      const group = await res.json();
      if (!res.ok) {
        toast.error(group.error ?? 'Failed to create group');
        return;
      }
      setGroups((prev) => [...prev, group]);
      setName('');
      setDescription('');
      setGroupDialogOpen(false);
      toast.success(`Group "${group.name}" created`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create group');
    } finally {
      setSaving(false);
    }
  }

  return (
    <TooltipProvider delayDuration={500}>
      <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex min-h-full flex-col">
          <PageActionBar>
            <span className="text-foreground text-xl font-medium">Projects</span>
            <PermissionGate permission="projects:create" mode="hide">
              <div className="flex items-center gap-2">
                {/* Split button: New Project + New Group */}
                <div className="relative flex items-center">
                  <Button size="md" onClick={() => setDialogOpen(true)} className="rounded-r-none">
                    <Plus className="mr-1 h-4 w-4" />
                    New Project
                  </Button>
                  <Button
                    size="md"
                    onClick={() => setSplitOpen(!splitOpen)}
                    className="rounded-l-none border-l border-l-white/20 px-1.5"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  {splitOpen && (
                    <div className="bg-surface-200 border-border absolute top-full right-0 z-20 mt-1 w-full min-w-full rounded-md border shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setName('');
                          setDescription('');
                          setGroupDialogOpen(true);
                          setSplitOpen(false);
                        }}
                        className="hover:bg-surface-100 flex w-full items-center gap-1 px-3 py-2 text-xs font-medium whitespace-nowrap"
                      >
                        <FolderOpen className="mr-1 h-4 w-4" /> New Group
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </PermissionGate>
          </PageActionBar>

          <PageTabs
            tabs={groupTabs}
            active={activeGroup}
            onChange={setActiveGroup}
            droppable
            suppressClick={!!dragActiveId}
          />

          {/* Filter & Sort bar */}
          <div className="flex items-center justify-between px-6 pt-6 pb-0">
            <div className="flex items-center gap-2">
              {/* Type filter dropdown */}
              <div className="relative" ref={typeDropdownRef}>
                <button
                  type="button"
                  onClick={() => setTypeDropdownOpen(!typeDropdownOpen)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activeTypeFilter !== 'all'
                      ? 'border-brand/40 bg-brand/10 text-brand'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-100'
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  {activeTypeFilter === 'all'
                    ? 'Type'
                    : TYPE_FILTERS.find((f) => f.id === activeTypeFilter)?.label}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {typeDropdownOpen && (
                  <div className="bg-surface-200 border-border absolute top-full left-0 z-20 mt-1 min-w-[160px] rounded-md border py-1 shadow-lg">
                    {TYPE_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => {
                          setActiveTypeFilter(filter.id);
                          setTypeDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                          activeTypeFilter === filter.id
                            ? 'bg-surface-100 text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                        }`}
                      >
                        <span>{filter.label}</span>
                        <span className="text-muted-foreground ml-3 tabular-nums">
                          {typeCounts[filter.id] ?? 0}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Completed toggle */}
              <button
                type="button"
                onClick={() => setHideCompleted((prev) => !prev)}
                title={hideCompleted ? 'Show completed projects' : 'Hide completed projects'}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  !hideCompleted
                    ? 'border-brand/40 bg-brand/10 text-brand'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-100'
                }`}
              >
                {hideCompleted ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                Completed
              </button>
            </div>
            {/* Sort toggle buttons */}
            <div className="border-border flex items-center rounded-md border">
              {SORT_MODES.map((m, idx) => {
                const Icon = m.icon;
                const active = sortBy === m.id;
                return (
                  <Tooltip key={m.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setSortBy(m.id)}
                        aria-label={`Sort: ${m.label}`}
                        className={`flex cursor-pointer items-center justify-center px-2 py-1.5 transition-colors ${
                          active
                            ? 'bg-surface-200 text-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                        } ${idx === 0 ? 'rounded-l-[5px]' : ''} ${idx === SORT_MODES.length - 1 ? 'rounded-r-[5px]' : ''}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      Sort: {m.label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {/* Group branch info — shown when a group tab is active */}
          {activeGroup !== 'all' &&
            (() => {
              const activeGroupData = groups.find((g) => g.id === activeGroup);
              if (!activeGroupData) return null;
              const meta = (activeGroupData.metadata as Record<string, unknown>) ?? {};
              if (!meta.branch) return null;
              const groupProjects = projects.filter((p) => p.group_id === activeGroup);
              const mergedCount = (meta.merged_count as number) ?? 0;
              return (
                <GroupBranchInfo
                  group={activeGroupData}
                  projectCount={groupProjects.length}
                  mergedCount={mergedCount}
                />
              );
            })()}

          <div className="px-6 pt-6 pb-6">
            {loading ? (
              <div className="border-border overflow-hidden rounded-lg border">
                <div className="bg-surface-100 border-border h-10 border-b" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-surface-300/30 border-border h-14 animate-pulse border-b"
                  />
                ))}
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={fetchData} />
            ) : sortedProjects.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title={
                  activeTypeFilter === 'all'
                    ? 'No projects yet'
                    : activeTypeFilter === 'system'
                      ? 'No system projects'
                      : activeTypeFilter === 'research'
                        ? 'No research projects'
                        : activeTypeFilter === 'plan'
                          ? 'No plan projects'
                          : 'No feature projects'
                }
                description={
                  activeTypeFilter === 'all'
                    ? 'Projects help you organize tasks into focused areas of work.'
                    : activeTypeFilter === 'system'
                      ? 'System projects track internal tooling, infrastructure, and platform maintenance.'
                      : activeTypeFilter === 'research'
                        ? 'Start a research project to explore ideas and document findings.'
                        : activeTypeFilter === 'plan'
                          ? 'Plan projects help you map out roadmaps and strategies.'
                          : 'Feature projects track new capabilities being built.'
                }
                action={
                  canEdit
                    ? {
                        label: `Create ${activeTypeFilter === 'system' ? 'a system' : 'a'} project`,
                        onClick: () => {
                          if (activeTypeFilter !== 'all')
                            setCreateType(activeTypeFilter as ProjectType);
                          setDialogOpen(true);
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <ProjectTable
                projects={sortedProjects}
                projectCounts={projectCounts}
                onToggleComplete={handleToggleComplete}
                onDelete={handleDeleteProject}
                onReorder={handleReorder}
                externalDnd={{ activeId: dragActiveId }}
              />
            )}
          </div>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                // Reset voice state when closing
                if (voiceListening) {
                  speech.stop();
                  speech.resetTranscript();
                  setVoiceListening(false);
                }
                setDialogMode('manual');
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle>New Project</DialogTitle>
                  {/* Mode toggle: Manual / Voice */}
                  {speech.isSupported && (
                    <div className="bg-surface-100 border-border flex rounded-lg border p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (voiceListening) {
                            speech.stop();
                            speech.resetTranscript();
                            setVoiceListening(false);
                          }
                          setDialogMode('manual');
                        }}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          dialogMode === 'manual'
                            ? 'bg-surface-200 text-foreground'
                            : 'text-foreground-lighter hover:text-foreground'
                        }`}
                      >
                        <PenLine className="h-3 w-3" />
                        Manual
                      </button>
                      <button
                        type="button"
                        onClick={() => setDialogMode('voice')}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          dialogMode === 'voice'
                            ? 'bg-surface-200 text-foreground'
                            : 'text-foreground-lighter hover:text-foreground'
                        }`}
                      >
                        <Mic className="h-3 w-3" />
                        Voice
                      </button>
                    </div>
                  )}
                </div>
              </DialogHeader>

              {dialogMode === 'voice' ? (
                /* Voice mode — pulsing mic circle */
                <div className="flex flex-col items-center gap-5 py-6">
                  {/* Animated ring + mic button */}
                  <div className="relative flex items-center justify-center">
                    {/* Outer glow */}
                    <div
                      className={`absolute rounded-full transition-all duration-500 ${
                        voiceListening ? 'bg-brand/8 h-32 w-32' : 'bg-surface-200 h-28 w-28'
                      }`}
                    />

                    {/* SVG ring */}
                    <svg className="absolute h-28 w-28" viewBox="0 0 112 112">
                      <circle
                        cx="56"
                        cy="56"
                        r="52"
                        fill="none"
                        strokeWidth="2"
                        className={`transition-all duration-300 ${
                          voiceListening ? 'stroke-brand/20' : 'stroke-surface-300'
                        }`}
                      />
                      {voiceListening && (
                        <circle
                          cx="56"
                          cy="56"
                          r="52"
                          fill="none"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          className="stroke-brand"
                          strokeDasharray="80 247"
                          style={{
                            transformOrigin: '56px 56px',
                            animation:
                              'voice-ring-spin 3s linear infinite, voice-ring-breathe 2s ease-in-out infinite',
                          }}
                        />
                      )}
                    </svg>

                    {/* Mic button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (voiceListening) {
                          speech.stop();
                          setVoiceListening(false);
                        } else {
                          speech.resetTranscript();
                          speech.start();
                          setVoiceListening(true);
                        }
                      }}
                      className={`relative z-10 flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 ${
                        voiceListening
                          ? 'bg-brand shadow-brand/25 hover:bg-brand/90 text-black shadow-lg'
                          : 'bg-surface-200 text-foreground-light border-border hover:bg-surface-300 hover:text-foreground border'
                      }`}
                      aria-label={voiceListening ? 'Stop recording' : 'Start recording'}
                    >
                      <Mic className="h-8 w-8" />
                    </button>
                  </div>

                  {/* Status label */}
                  <span
                    className={`text-sm font-medium ${
                      voiceListening ? 'text-brand' : 'text-foreground-lighter'
                    }`}
                  >
                    {voiceListening ? 'Listening…' : 'Tap to describe your project'}
                  </span>

                  {/* Live transcript */}
                  {(speech.transcript || speech.interimText) && voiceListening && (
                    <div className="w-full max-w-[320px]">
                      <div className="bg-surface-100 border-border rounded-xl border px-4 py-3 text-center">
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
                    </div>
                  )}

                  {speech.error && <p className="text-destructive text-xs">{speech.error}</p>}

                  <p className="text-foreground-lighter max-w-[240px] text-center text-xs leading-relaxed">
                    Say the project name and I'll fill in the form. For example, &ldquo;User
                    authentication system&rdquo;
                  </p>

                  {/* Keyframe animations: voice-ring-spin, voice-ring-breathe defined in theme.css */}
                </div>
              ) : (
                /* Manual mode — existing form */
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Type</label>
                    <div className="flex gap-2">
                      {(['feature', 'system', 'research', 'plan'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setCreateType(type)}
                          className={`rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                            createType === type
                              ? 'border-brand bg-brand/10 text-brand'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Name</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Project name"
                      required
                    />
                  </div>
                  {groups.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Group</label>
                      <select
                        value={createGroupId ?? ''}
                        onChange={(e) => setCreateGroupId(e.target.value || null)}
                        className="border-border bg-surface-200 text-foreground w-full rounded-md border px-3 py-2 text-sm"
                      >
                        <option value="">No group</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description</label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional description"
                      rows={3}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={saving}>
                      {saving ? 'Creating...' : 'Create Project'}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Project Group</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateGroup} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Group name (e.g. Q2 Initiatives)"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Creating...' : 'Create Group'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </DndContext>
    </TooltipProvider>
  );
}
