'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  Eye,
  EyeOff,
  Filter,
  FolderOpen,
  Mic,
  PenLine,
  Plus,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
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
import type { Project, ProjectGroup, ProjectType, Task } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { createClient } from '@repo/db/client';
import { useSpeechRecognition } from '@/hooks/use-speech-recognition';

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'feature', label: 'Features' },
  { id: 'system', label: 'System' },
  { id: 'research', label: 'Research' },
  { id: 'plan', label: 'Plans' },
] as const;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
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
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'manual' | 'name' | 'created' | 'progress'>('manual');
  const [dialogMode, setDialogMode] = useState<'manual' | 'voice'>('manual');
  const [voiceListening, setVoiceListening] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // Voice input for project creation
  const handleVoiceTranscript = useCallback((text: string) => {
    setName(text.trim());
    setDialogMode('manual');
    setVoiceListening(false);
  }, []);

  const speech = useSpeechRecognition({
    onFinalTranscript: handleVoiceTranscript,
  });

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchJson<Project[]>(apiUrl('/api/projects')),
      fetchJson<Task[]>(apiUrl('/api/tasks')),
      fetchJson<ProjectGroup[]>(apiUrl('/api/project-groups')).catch(() => [] as ProjectGroup[]),
    ])
      .then(([p, t, g]) => {
        setProjects(p);
        setTasks(t);
        setGroups(g);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load projects';
        setError(message);
      })
      .finally(() => setLoading(false));
  }, []);

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
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
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

  const projectCounts = useMemo(() => {
    const map: Record<string, { taskCount: number; doneCount: number; hasActiveTask: boolean }> =
      {};
    for (const t of tasks) {
      if (!t.project_id) continue;
      if (!map[t.project_id])
        map[t.project_id] = { taskCount: 0, doneCount: 0, hasActiveTask: false };
      map[t.project_id].taskCount++;
      if (t.status === 'done') map[t.project_id].doneCount++;
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      if (meta.active_session && t.status !== 'done') map[t.project_id].hasActiveTask = true;
    }
    return map;
  }, [tasks]);

  const visibleProjects = useMemo(() => {
    if (!hideCompleted) return projects;
    return projects.filter((p) => p.status !== 'completed');
  }, [projects, hideCompleted]);

  const groupFilteredProjects = useMemo(() => {
    if (activeGroup === 'all') return visibleProjects;
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
      { id: 'all', label: `All (${visibleProjects.length})` },
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

  const handleReorder = useCallback((reordered: Project[]) => {
    setProjects((prev) => {
      // Merge reordered sort_orders into the full project list
      const map = new Map(reordered.map((p) => [p.id, p]));
      return prev
        .map((p) => map.get(p.id) ?? p)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    });
  }, []);

  const handleToggleComplete = useCallback(async (project: Project) => {
    const newStatus = project.status === 'completed' ? 'active' : 'completed';
    // Optimistic update
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, status: newStatus } : p)));
    try {
      const res = await fetch(apiUrl(`/api/projects/${project.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
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
  }, []);

  const handleDeleteProject = useCallback(async (project: Project) => {
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    // Optimistic removal
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
    try {
      const res = await fetch(apiUrl(`/api/projects/${project.id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete project');
      toast.success(`"${project.name}" deleted`);
    } catch {
      // Rollback
      setProjects((prev) =>
        [...prev, project].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      );
      toast.error('Failed to delete project');
    }
  }, []);

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
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Projects</span>
        <div className="flex items-center gap-2">
          {/* Split button: New Project + New Group */}
          <div className="flex items-center">
            <Button size="md" onClick={() => setDialogOpen(true)} className="rounded-r-none">
              <Plus className="mr-1 h-4 w-4" />
              New Project
            </Button>
            <div className="relative">
              <Button
                size="md"
                onClick={() => setSplitOpen(!splitOpen)}
                className="rounded-l-none border-l border-l-white/20 px-1.5"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              {splitOpen && (
                <div className="bg-surface-200 border-border absolute top-full right-0 z-20 mt-1 rounded-md border shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setName('');
                      setDescription('');
                      setGroupDialogOpen(true);
                      setSplitOpen(false);
                    }}
                    className="hover:bg-surface-100 flex items-center gap-2 px-4 py-2 text-sm whitespace-nowrap"
                  >
                    <FolderOpen className="h-4 w-4" /> New Group
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </PageActionBar>

      <PageTabs tabs={groupTabs} active={activeGroup} onChange={setActiveGroup} />

      {/* Filter & Sort bar */}
      <div className="border-border flex items-center justify-between border-b px-6 py-2">
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
            {hideCompleted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            Completed
          </button>
        </div>
        {/* Sort dropdown */}
        <div className="relative" ref={sortDropdownRef}>
          <button
            type="button"
            onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              sortBy !== 'manual'
                ? 'border-brand/40 bg-brand/10 text-brand'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-100'
            }`}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortBy === 'manual'
              ? 'Sort'
              : sortBy === 'name'
                ? 'Name'
                : sortBy === 'created'
                  ? 'Newest'
                  : 'Progress'}
          </button>
          {sortDropdownOpen && (
            <div className="bg-surface-200 border-border absolute top-full right-0 z-20 mt-1 min-w-[140px] rounded-md border py-1 shadow-lg">
              {(
                [
                  { id: 'manual', label: 'Manual' },
                  { id: 'name', label: 'Name' },
                  { id: 'created', label: 'Newest' },
                  { id: 'progress', label: 'Progress' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setSortBy(option.id);
                    setSortDropdownOpen(false);
                  }}
                  className={`flex w-full items-center px-3 py-1.5 text-xs transition-colors ${
                    sortBy === option.id
                      ? 'bg-surface-100 text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
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
            action={{
              label: `Create ${activeTypeFilter === 'system' ? 'a system' : 'a'} project`,
              onClick: () => {
                if (activeTypeFilter !== 'all') setCreateType(activeTypeFilter as ProjectType);
                setDialogOpen(true);
              },
            }}
          />
        ) : (
          <ProjectTable
            projects={sortedProjects}
            projectCounts={projectCounts}
            groups={groups}
            groupMap={groupMap}
            onToggleComplete={handleToggleComplete}
            onDelete={handleDeleteProject}
            onReorder={handleReorder}
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
  );
}
