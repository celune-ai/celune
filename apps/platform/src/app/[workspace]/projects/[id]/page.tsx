'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  LayoutGrid,
  Layers,
  Link2,
  List,
  MoreVertical,
  Pencil,
  Save,
  Plus,
  FileText,
  Trash2,
  Info,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { TaskBoard, type TaskBoardHandle } from '@celuneai/react/tasks';
import { TaskListView, type TaskListViewHandle } from '@celuneai/react/tasks';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@repo/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { toast } from 'sonner';
import { useViewPreferences } from '@/hooks/use-view-preferences';
import { useCanEdit } from '@/hooks/use-can-edit';
import type { Project, Task, TaskStatus } from '@repo/types';
import { TASK_STATUSES, TASK_STATUS_LABELS, getProjectDocLabel } from '@repo/types';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useWorkspace } from '@/providers/workspace-provider';
import { createClient } from '@repo/db/client';
import { PrdDrawer } from '@/components/prd-drawer';
import { ProjectProgressLog } from '@celuneai/react/projects';
import { PRStatusBadge } from '@/components/pr-status-badge';
import { PRDetailDrawer } from '@/components/pr-detail-drawer';
import { NakedInput } from '@repo/ui/components/naked-input';
import type { TaskSortMode } from '@celuneai/react/utils';
import type { ProjectPR } from '@repo/types';
import { parseGitHubUrl } from '@/lib/github-utils';
import { useTableColumns } from '@celuneai/react/hooks';

const SORT_MODES: { value: TaskSortMode; label: string; icon: typeof ArrowUpDown }[] = [
  { value: 'sequence', label: 'Sequence', icon: GitBranch },
  { value: 'manual', label: 'Manual', icon: ArrowUpDown },
  { value: 'recency', label: 'Recency', icon: Clock },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { workspaceHref } = useWorkspaceHref();
  const { activeWorkspace } = useWorkspace();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [prdOpen, setPrdOpen] = useState(false);
  const [prdCreateMode, setPrdCreateMode] = useState(false);
  const {
    viewMode,
    sortMode,
    showSprint,
    handleViewChange,
    handleSortChange,
    handleDragReorder,
    handleSprintToggle,
  } = useViewPreferences();
  const viewRef = useRef<TaskBoardHandle & TaskListViewHandle>(null);
  const canEdit = useCanEdit();
  const { columns, updateColumnWidth, reorderColumns, gridTemplate, minWidth } = useTableColumns();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<TaskStatus>('backlog');
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsDescription, setDetailsDescription] = useState('');
  const [detailsCategory, setDetailsCategory] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [projectPRs, setProjectPRs] = useState<ProjectPR[]>([]);
  const [prDrawerOpen, setPrDrawerOpen] = useState(false);
  const [selectedPR, setSelectedPR] = useState<ProjectPR | null>(null);

  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}${workspaceHref(`/projects/${id}`)}`;
    navigator.clipboard.writeText(url);
    toast.success('URL copied to clipboard');
  }, [id, workspaceHref]);

  const handleStartRename = useCallback(() => {
    if (!project) return;
    setDraftName(project.name);
    setEditingName(true);
  }, [project]);

  const handleSaveName = useCallback(async () => {
    if (!project) return;
    const trimmed = draftName.trim();
    setEditingName(false);
    if (!trimmed || trimmed === project.name) return;
    const prev = project.name;
    setProject({ ...project, name: trimmed });
    try {
      const res = await fetch(
        apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace?.id}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        },
      );
      if (!res.ok) throw new Error('Failed to rename');
      const updated: Project = await res.json();
      setProject(updated);
      toast.success('Project renamed');
    } catch {
      setProject({ ...project, name: prev });
      toast.error('Failed to rename project');
    }
  }, [project, draftName]);

  const handleDelete = useCallback(
    async (mode: 'delete-all' | 'move-tasks', targetStatus?: TaskStatus) => {
      if (!project) return;
      setDeleting(true);
      try {
        if (mode === 'move-tasks' && targetStatus) {
          for (const task of tasks) {
            await fetch(apiUrl(`/api/tasks/${task.id}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: null, status: targetStatus }),
            });
          }
        }
        const res = await fetch(
          apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace?.id}`),
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error('Failed to delete project');
        if (mode === 'move-tasks' && tasks.length > 0 && targetStatus) {
          const label = TASK_STATUS_LABELS[targetStatus];
          toast.success(
            `Project deleted — ${tasks.length} task${tasks.length === 1 ? '' : 's'} moved to ${label}`,
          );
        } else {
          toast.success('Project and tasks deleted');
        }
        router.push(workspaceHref('/projects'));
      } catch {
        toast.error('Failed to delete project');
        setDeleting(false);
      }
    },
    [project, tasks, router, workspaceHref],
  );

  useEffect(() => {
    if (!activeWorkspace?.id) return;

    const fetchData = () => {
      Promise.all([
        fetchJson<Project>(apiUrl(`/api/projects/${id}?workspace_id=${activeWorkspace.id}`)),
        fetchJson<Task[]>(apiUrl(`/api/tasks?project_id=${id}&workspace_id=${activeWorkspace.id}`)),
      ])
        .then(([p, t]) => {
          setProject(p);
          setTasks(t);
        })
        .catch(() => {
          /* Handled by loading state — empty UI is acceptable */
        })
        .finally(() => setLoading(false));
    };

    const fetchPRs = () => {
      fetchJson<{ prs: ProjectPR[] }>(
        apiUrl(`/api/github/prs?workspace_id=${activeWorkspace.id}&project_id=${id}`),
      )
        .then(({ prs }) => setProjectPRs(prs))
        .catch(() => {
          /* Non-critical — PR list is supplementary */
        });
    };

    fetchData();
    fetchPRs();

    // Refetch when tab becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Subscribe to Supabase Realtime for live task updates
    const supabase = createClient();
    const channel = supabase
      .channel(`project-detail-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchData();
      })
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${id}` },
        () => {
          fetchData();
        },
      )
      .subscribe();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [id, activeWorkspace?.id]);

  const isCompleted = project?.status === 'completed';

  // Derive Git info from workspace + task metadata
  const gitInfo = useMemo(() => {
    const repoUrl = activeWorkspace?.repo_url;
    if (!repoUrl) return null;

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) return null;
    const ownerRepo = parsed.fullName;

    // Find branch and PR info from task metadata
    let branch: string | null = null;
    let prUrl: string | null = null;
    let prNumber: number | null = null;

    for (const task of tasks) {
      const meta = task.metadata as Record<string, unknown> | null;
      if (!meta) continue;
      if (!branch && meta.branch) branch = meta.branch as string;
      if (!prUrl && meta.pr_url) {
        prUrl = meta.pr_url as string;
        prNumber = (meta.pr_number as number) ?? null;
      }
    }

    // Also check project metadata
    const projMeta = project?.metadata as Record<string, unknown> | null;
    if (projMeta) {
      if (!branch && projMeta.branch) branch = projMeta.branch as string;
      if (!prUrl && projMeta.pr_url) {
        prUrl = projMeta.pr_url as string;
        prNumber = (projMeta.pr_number as number) ?? null;
      }
    }

    return { ownerRepo, branch, prUrl, prNumber };
  }, [activeWorkspace?.repo_url, tasks, project?.metadata]);

  const handleToggleComplete = useCallback(async () => {
    if (!project) return;
    const newStatus = isCompleted ? 'active' : 'completed';
    setProject({ ...project, status: newStatus });
    try {
      const res = await fetch(
        apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace?.id}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) throw new Error('Failed to update project status');
      const updated: Project = await res.json();
      setProject(updated);
      toast.success(newStatus === 'completed' ? 'Project completed' : 'Project reopened');
    } catch {
      setProject(project);
      toast.error('Failed to update project status');
    }
  }, [project, isCompleted]);

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-full flex-col overflow-hidden">
        <PageActionBar>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => router.back()}
                  aria-label="Back to projects"
                  className="text-foreground-muted hover:bg-surface-200 hover:text-foreground rounded-md p-1 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Back
              </TooltipContent>
            </Tooltip>
            {loading ? (
              <div className="bg-surface-300 h-4 w-32 animate-pulse rounded" />
            ) : project ? (
              <div className="flex min-w-0 items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleToggleComplete}
                      aria-label={isCompleted ? 'Mark as active' : 'Mark as completed'}
                      className="flex shrink-0 cursor-pointer items-center"
                    >
                      <CheckCircle2
                        className={`h-5 w-5 transition-colors ${
                          isCompleted
                            ? 'text-green-500'
                            : 'text-foreground-lighter hover:text-green-500'
                        }`}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {isCompleted ? 'Mark as active' : 'Mark as completed'}
                  </TooltipContent>
                </Tooltip>
                {editingName && canEdit ? (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <NakedInput
                      value={draftName}
                      onChange={setDraftName}
                      onSave={handleSaveName}
                      onCancel={() => setEditingName(false)}
                      inputClassName="text-foreground text-xl font-medium"
                    />
                    <Button
                      size="icon-sm"
                      variant="outline"
                      onClick={() => handleSaveName()}
                      className="shrink-0"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : canEdit ? (
                  <button
                    type="button"
                    onClick={handleStartRename}
                    className="group/name flex max-w-full min-w-0 cursor-pointer items-center"
                  >
                    <span className="text-foreground min-w-0 truncate text-xl font-medium">
                      {project.name}
                    </span>
                    <span className="border-border text-muted-foreground hover:bg-surface-100 hover:text-foreground group-hover/name:border-border ml-2 flex h-7 w-0 items-center justify-center overflow-hidden rounded-md border border-transparent opacity-0 transition-all duration-200 ease-out group-hover/name:w-7 group-hover/name:opacity-100">
                      <Pencil className="h-3.5 w-3.5 shrink-0" />
                    </span>
                  </button>
                ) : (
                  <span className="text-foreground min-w-0 truncate text-xl font-medium">
                    {project.name}
                  </span>
                )}
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                    project.status === 'completed'
                      ? 'border-green-500/40 text-green-400'
                      : project.status === 'paused'
                        ? 'border-amber-500/40 text-amber-400'
                        : project.status === 'archived'
                          ? 'border-surface-400/40 text-surface-400'
                          : 'border-brand/40 text-brand'
                  }`}
                >
                  {project.status === 'completed'
                    ? 'Completed'
                    : project.status === 'paused'
                      ? 'Paused'
                      : project.status === 'archived'
                        ? 'Archived'
                        : 'Active'}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                    (project.project_type ?? 'feature') === 'research'
                      ? 'border-violet-500/40 text-violet-400'
                      : (project.project_type ?? 'feature') === 'plan'
                        ? 'border-sky-500/40 text-sky-400'
                        : (project.project_type ?? 'feature') === 'system'
                          ? 'border-amber-500/40 text-amber-400'
                          : 'border-border text-foreground-light'
                  }`}
                >
                  {project.project_type ?? 'feature'}
                </span>
                {projectPRs.map((pr) => (
                  <PRStatusBadge
                    key={pr.id}
                    pr={pr}
                    onClick={() => {
                      setSelectedPR(pr);
                      setPrDrawerOpen(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <span className="text-foreground text-xl font-medium">Project not found</span>
            )}
          </div>
          {project && (
            <div className="flex items-center gap-2">
              {/* Stateful Git button */}
              {gitInfo?.prUrl ? (
                <a href={gitInfo.prUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="md" className="bg-white text-black hover:bg-white/90">
                    <GitPullRequest className="mr-1.5 h-4 w-4" />
                    View PR
                    <ExternalLink className="ml-1.5 h-3 w-3 opacity-50" />
                  </Button>
                </a>
              ) : gitInfo?.branch ? (
                <a
                  href={`https://github.com/${gitInfo.ownerRepo}/tree/${gitInfo.branch}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="md" variant="outline">
                    <GitBranch className="mr-1.5 h-4 w-4" />
                    {gitInfo.branch.length > 25
                      ? gitInfo.branch.slice(0, 22) + '...'
                      : gitInfo.branch}
                    <ExternalLink className="ml-1.5 h-3 w-3 opacity-50" />
                  </Button>
                </a>
              ) : gitInfo ? (
                <a
                  href={`https://github.com/${gitInfo.ownerRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="md" variant="outline">
                    <GitBranch className="mr-1.5 h-4 w-4" />
                    New Branch
                    <ExternalLink className="ml-1.5 h-3 w-3 opacity-50" />
                  </Button>
                </a>
              ) : null}
              {/* Create PR shortcut — only when branch exists but no PR yet */}
              {!gitInfo?.prUrl && gitInfo?.branch ? (
                <a
                  href={`https://github.com/${gitInfo.ownerRepo}/compare/${gitInfo.branch}?expand=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="md" variant="outline">
                    <GitPullRequest className="mr-1.5 h-4 w-4" />
                    Create PR
                    <ExternalLink className="ml-1.5 h-3 w-3 opacity-50" />
                  </Button>
                </a>
              ) : null}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="md"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label="Project menu"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Menu
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" collisionPadding={8}>
                  <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
                    <Link2 className="h-4 w-4" />
                    Copy URL
                  </DropdownMenuItem>
                  {canEdit && (
                    <DropdownMenuItem
                      onClick={() => setDeleteDialogOpen(true)}
                      className="cursor-pointer text-red-400 focus:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Project
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="md"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label="Project details"
                    onClick={() => {
                      setDetailsDescription(project.description ?? '');
                      setDetailsCategory(
                        Array.isArray(project.category)
                          ? project.category.join(', ')
                          : (project.category ?? ''),
                      );
                      setDetailsOpen(true);
                    }}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Details
                </TooltipContent>
              </Tooltip>
              {project.prd_content?.trim() ? (
                <Button
                  size="md"
                  variant="outline"
                  onClick={() => {
                    setPrdCreateMode(false);
                    setPrdOpen(true);
                  }}
                >
                  <FileText className="mr-1 h-4 w-4" />
                  View {getProjectDocLabel(project.project_type, project.category).shortLabel}
                </Button>
              ) : canEdit ? (
                <Button
                  size="md"
                  variant="ghost"
                  onClick={() => {
                    setPrdCreateMode(true);
                    setPrdOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add {getProjectDocLabel(project.project_type, project.category).shortLabel}
                </Button>
              ) : null}
              {canEdit && (
                <Button size="md" onClick={() => viewRef.current?.openNewTask()}>
                  <Plus className="mr-1 h-4 w-4" />
                  New Task
                </Button>
              )}
            </div>
          )}
        </PageActionBar>

        {/* Filter row — matches tasks page layout */}
        {project && (
          <div className="flex items-center justify-between px-6 pt-6 pb-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSprintToggle}
                title="Toggle sprint labels"
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  showSprint
                    ? 'border-border bg-surface-200 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-surface-100'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Sprints
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Board / List toggle */}
              <div className="border-border flex items-center rounded-md border">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleViewChange('board')}
                      aria-label="Board view"
                      className={`flex cursor-pointer items-center gap-1.5 rounded-l-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        viewMode === 'board'
                          ? 'bg-surface-200 text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                      }`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Board
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleViewChange('list')}
                      aria-label="List view"
                      className={`flex cursor-pointer items-center gap-1.5 rounded-r-[5px] px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        viewMode === 'list'
                          ? 'bg-surface-200 text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-surface-100'
                      }`}
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    List
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="border-border flex items-center rounded-md border">
                {SORT_MODES.map((m, idx) => {
                  const Icon = m.icon;
                  const active = sortMode === m.value;
                  return (
                    <Tooltip key={m.value}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleSortChange(m.value)}
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
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden pt-6 pb-6">
          {loading ? (
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-200 h-64 w-64 shrink-0 animate-pulse rounded-lg"
                />
              ))}
            </div>
          ) : !project ? (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">Project not found</p>
            </div>
          ) : viewMode === 'board' ? (
            <TaskBoard
              ref={viewRef}
              initialTasks={tasks}
              projectId={id}
              sortMode={sortMode}
              showSprint={showSprint}
              onDragReorder={handleDragReorder}
            />
          ) : (
            <TaskListView
              ref={viewRef}
              initialTasks={tasks}
              projectId={id}
              sortMode={sortMode}
              showSprint={showSprint}
              onDragReorder={handleDragReorder}
              columns={columns}
              gridTemplate={gridTemplate}
              minWidth={minWidth}
              onColumnResize={updateColumnWidth}
              onColumnReorder={reorderColumns}
            />
          )}

          {/* Progress Log — shows completed task outcomes */}
          {project &&
            activeWorkspace?.id &&
            tasks.some((t) => t.status === 'done' && t.outcome) && (
              <div className="mt-6 px-1">
                <ProjectProgressLog projectId={id} />
              </div>
            )}
        </div>

        <PrdDrawer
          open={prdOpen}
          project={project}
          taskCount={tasks.length}
          initialEditMode={prdCreateMode}
          onClose={() => setPrdOpen(false)}
          onSaved={(updated) => setProject(updated)}
        />

        <PRDetailDrawer
          open={prDrawerOpen}
          pr={selectedPR}
          workspaceId={activeWorkspace?.id ?? ''}
          onClose={() => setPrDrawerOpen(false)}
        />

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Project</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{project?.name}</strong>?
                {tasks.length > 0
                  ? ` This project has ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`
                  : ''}{' '}
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 pt-2">
              <Button
                variant="outline"
                onClick={() => handleDelete('delete-all')}
                disabled={deleting}
                className="w-full border-red-500/60 bg-red-950/30 text-red-400 hover:bg-red-950/50 hover:text-red-300"
              >
                {deleting ? 'Deleting...' : 'Delete Project and Tasks'}
              </Button>
              {tasks.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteDialogOpen(false);
                    setMoveTarget('backlog');
                    setMoveDialogOpen(true);
                  }}
                  disabled={deleting}
                  className="w-full border-red-500/60 bg-red-950/30 text-red-400 hover:bg-red-950/50 hover:text-red-300"
                >
                  Delete Project and Move Tasks
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move Tasks</DialogTitle>
              <DialogDescription>
                Choose where to move {tasks.length} task{tasks.length === 1 ? '' : 's'} before
                deleting <strong>{project?.name}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="pt-2">
              <label className="text-sm font-medium">Move to</label>
              <Select value={moveTarget} onValueChange={(v) => setMoveTarget(v as TaskStatus)}>
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {TASK_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="flex-row gap-2 sm:justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setMoveDialogOpen(false);
                  setDeleteDialogOpen(true);
                }}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => handleDelete('move-tasks', moveTarget)}
                disabled={deleting}
                className="border-red-500/60 bg-red-950/30 text-red-400 hover:bg-red-950/50 hover:text-red-300"
              >
                {deleting ? 'Deleting...' : 'Delete and Move Tasks'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Project Details Dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Project Details</DialogTitle>
              <DialogDescription>View and edit project metadata.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-foreground text-sm font-medium">Status</label>
                <p className="text-foreground-lighter mt-1 text-sm capitalize">
                  {project?.status ?? '—'}
                </p>
              </div>
              <div>
                <label className="text-foreground text-sm font-medium">Type</label>
                <p className="text-foreground-lighter mt-1 text-sm">
                  {project?.project_type ?? '—'}
                </p>
              </div>
              <div>
                <label htmlFor="details-category" className="text-foreground text-sm font-medium">
                  Category
                </label>
                <input
                  id="details-category"
                  value={detailsCategory}
                  onChange={(e) => setDetailsCategory(e.target.value)}
                  disabled={!canEdit}
                  className="border-border bg-surface-200 text-foreground placeholder:text-muted-foreground mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:border-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none disabled:opacity-50"
                  placeholder="engineering, design, ..."
                />
              </div>
              <div>
                <label htmlFor="details-desc" className="text-foreground text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="details-desc"
                  value={detailsDescription}
                  onChange={(e) => setDetailsDescription(e.target.value)}
                  disabled={!canEdit}
                  rows={5}
                  className="border-border bg-surface-200 text-foreground placeholder:text-muted-foreground mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:border-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none disabled:opacity-50"
                  placeholder="Project description..."
                />
              </div>
              <div className="text-muted-foreground space-y-1 text-xs">
                <p>Created: {project ? new Date(project.created_at).toLocaleString() : '—'}</p>
                {project?.updated_at && (
                  <p>Updated: {new Date(project.updated_at).toLocaleString()}</p>
                )}
              </div>
            </div>
            {canEdit && (
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailsOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    if (!project) return;
                    setDetailsSaving(true);
                    try {
                      const categoryArr = detailsCategory
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const res = await fetch(
                        apiUrl(`/api/projects/${project.id}?workspace_id=${activeWorkspace?.id}`),
                        {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            description: detailsDescription || null,
                            category: categoryArr.length > 0 ? categoryArr : null,
                          }),
                        },
                      );
                      if (!res.ok) throw new Error('Failed to update');
                      const updated: Project = await res.json();
                      setProject(updated);
                      toast.success('Project details updated');
                      setDetailsOpen(false);
                    } catch {
                      toast.error('Failed to update project details');
                    } finally {
                      setDetailsSaving(false);
                    }
                  }}
                  disabled={detailsSaving}
                >
                  {detailsSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
