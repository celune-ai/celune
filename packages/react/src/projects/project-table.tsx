'use client';

import { useCallback, useId, useState, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, GripVertical, MoreVertical, Trash2, Link2 } from 'lucide-react';
import { cn } from '@repo/ui/utils';
import type { Project, ProjectGroup, ProjectType } from '@repo/types';
import { useCelune } from '../provider/context';

// ---------------------------------------------------------------------------
// Grid layout — 10 columns: handle + original 9
// ---------------------------------------------------------------------------

const GRID_COLS = '24px 36px 1fr 120px max-content 16px max-content max-content 100px 48px 36px';
const COL_COUNT = 11;

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

type DisplayStatus = 'scoping' | 'in_progress' | 'completed' | 'paused' | 'archived';

function deriveDisplayStatus(project: Project, hasTasks: boolean): DisplayStatus {
  if (project.status === 'completed') return 'completed';
  if (project.status === 'paused') return 'paused';
  if (project.status === 'archived') return 'archived';
  if (!project.prd_content) return 'scoping';
  if (hasTasks) return 'in_progress';
  return 'scoping';
}

const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  scoping: 'Scoping',
  in_progress: 'In Progress',
  completed: 'Completed',
  paused: 'Paused',
  archived: 'Archived',
};

const DISPLAY_STATUS_COLORS: Record<DisplayStatus, string> = {
  scoping: 'border-(--celune-border-strong) bg-(--celune-border-strong) text-(--celune-on-status)',
  in_progress: 'border-(--celune-primary) bg-(--celune-primary) text-(--celune-on-status)',
  completed: 'border-(--celune-status-done) bg-(--celune-status-done) text-(--celune-on-status)',
  paused: 'border-(--celune-status-review) bg-(--celune-status-review) text-(--celune-on-status)',
  archived:
    'border-(--celune-status-archived) bg-(--celune-status-archived) text-(--celune-on-status)',
};

// ---------------------------------------------------------------------------
// Sortable project row — uses subgrid to inherit parent column tracks
// ---------------------------------------------------------------------------

interface ProjectRowProps {
  project: Project;
  counts: { taskCount: number; doneCount: number; hasActiveTask?: boolean };
  onToggleComplete?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  isDragOverlay?: boolean;
}

function ProjectRow({
  project,
  counts,
  onToggleComplete,
  onDelete,
  isDragOverlay,
}: ProjectRowProps) {
  const { href: workspaceHref, Link } = useCelune();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.id,
  });

  const pct = counts.taskCount > 0 ? Math.round((counts.doneCount / counts.taskCount) * 100) : 0;
  const type: ProjectType = project.project_type ?? 'feature';
  const isCompleted = project.status === 'completed';
  const allDone = counts.taskCount > 0 && counts.doneCount === counts.taskCount;
  const canToggle = isCompleted || allDone;
  const displayStatus = deriveDisplayStatus(project, counts.taskCount > 0);
  const isActive = !!counts.hasActiveTask && !isCompleted;

  const rowBg = isCompleted ? 'bg-(--celune-status-done)/10' : 'hover:bg-(--celune-surface)/50';
  const fade = isCompleted ? ' opacity-50' : '';

  const style: React.CSSProperties = isDragOverlay
    ? { gridTemplateColumns: GRID_COLS }
    : {
        gridColumn: `1 / -1`,
        gridTemplateColumns: 'subgrid',
        transform: CSS.Transform.toString(transform),
        transition,
      };

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      role="row"
      style={{
        ...style,
        ...(isActive
          ? ({ '--task-agent-color': 'var(--color-brand)' } as React.CSSProperties)
          : {}),
      }}
      className={cn(
        'group grid items-center transition-colors',
        'border-b border-(--celune-border)',
        rowBg,
        isActive && 'animate-task-active border-l-2 border-l-(--celune-primary)',
        isDragging && 'opacity-50',
        isDragOverlay && 'rotate-1 rounded-md border bg-(--celune-surface-hover) shadow-lg',
      )}
      {...(isDragOverlay ? {} : { ...attributes })}
    >
      {/* Drag handle — always visible */}
      <div className="flex items-center justify-center py-5">
        <button
          type="button"
          className="cursor-grab opacity-60 hover:opacity-100 active:cursor-grabbing"
          {...(isDragOverlay ? {} : { ...listeners })}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <GripVertical className="h-4 w-4 text-(--celune-fg-muted)" />
        </button>
      </div>

      {/* Complete toggle */}
      <div className="flex items-center justify-center py-5">
        <button
          type="button"
          disabled={!canToggle}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (canToggle) onToggleComplete?.(project);
          }}
          title={
            isCompleted
              ? 'Mark as active'
              : allDone
                ? 'Mark as completed'
                : 'Complete all tasks first'
          }
          className="flex cursor-pointer items-center disabled:cursor-not-allowed"
        >
          <CheckCircle2
            className={`h-4.5 w-4.5 transition-colors ${
              isCompleted
                ? 'text-(--celune-status-done)'
                : canToggle
                  ? 'text-(--celune-fg-muted) hover:text-(--celune-status-done)'
                  : 'text-(--celune-surface-hover)'
            }`}
          />
        </button>
      </div>

      {/* Name */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex min-w-0 items-center overflow-hidden px-4 py-5${fade}`}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-(weight:--celune-font-weight-medium) text-(--celune-fg)">
            {project.name}
          </p>
          {project.description && (
            <p className="mt-0.5 truncate text-xs text-(--celune-fg-muted)">
              {project.description}
            </p>
          )}
        </div>
      </Link>

      {/* Type */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex items-center px-4 py-5${fade}`}
      >
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-(weight:--celune-font-weight-medium) capitalize',
            type === 'research' &&
              'border-(--celune-status-planning)/40 text-(--celune-status-planning)',
            type === 'plan' &&
              'border-(--celune-priority-normal)/40 text-(--celune-priority-normal)',
            type === 'system' && 'border-(--celune-status-review)/40 text-(--celune-status-review)',
            type === 'feature' && 'border-(--celune-border) text-(--celune-fg-muted)',
          )}
        >
          {type}
        </span>
      </Link>

      {/* Priority */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex items-center px-4 py-5${fade}`}
      >
        {project.priority === 'urgent' || project.priority === 'high' ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-(weight:--celune-font-weight-medium) capitalize',
              project.priority === 'urgent' && 'border-(--celune-danger)/40 text-(--celune-danger)',
              project.priority === 'high' &&
                'border-(--celune-status-review)/40 text-(--celune-status-review)',
            )}
          >
            {project.priority}
          </span>
        ) : (
          <span className="text-xs text-(--celune-fg-muted) capitalize">{project.priority}</span>
        )}
      </Link>

      {/* Gap */}
      <div />

      {/* Status */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex items-center px-4 py-5${fade}`}
      >
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-(weight:--celune-font-weight-medium) whitespace-nowrap ${DISPLAY_STATUS_COLORS[displayStatus]}`}
        >
          {DISPLAY_STATUS_LABELS[displayStatus]}
        </span>
      </Link>

      {/* Category */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex items-center px-4 py-5${fade}`}
      >
        {project.category ? (
          <span className="inline-flex items-center rounded-full border border-(--celune-border) px-2 py-0.5 text-xs font-(weight:--celune-font-weight-medium) whitespace-nowrap text-(--celune-fg-muted) capitalize">
            {project.category}
          </span>
        ) : (
          <span className="text-xs text-(--celune-fg-muted)">&mdash;</span>
        )}
      </Link>

      {/* Progress bar */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex items-center px-4 py-5${fade}`}
      >
        {counts.taskCount > 0 ? (
          <div className="h-1.5 w-full rounded-full bg-(--celune-surface-hover)">
            <div
              className="h-1.5 rounded-full bg-(--celune-primary) transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <span className="text-xs text-(--celune-fg-muted)">&mdash;</span>
        )}
      </Link>

      {/* Progress count */}
      <Link
        href={workspaceHref(`/projects/${project.id}`)}
        className={`flex items-center py-5 pr-4${fade}`}
      >
        {counts.taskCount > 0 && (
          <span
            className={`text-xs tabular-nums ${
              allDone
                ? 'font-(weight:--celune-font-weight-strong) text-(--celune-status-done)'
                : 'text-(--celune-fg-muted)'
            }`}
          >
            {counts.doneCount}/{counts.taskCount}
          </span>
        )}
      </Link>

      {/* Actions menu */}
      <div className="relative flex items-center justify-center py-5" ref={menuRef}>
        {!isDragOverlay && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="rounded p-0.5 text-(--celune-fg-muted) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--celune-fg) data-[open]:opacity-100"
              data-open={menuOpen || undefined}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                {/* Invisible backdrop to close menu */}
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute top-full right-0 z-20 mt-1 min-w-[160px] rounded-md border border-(--celune-border) bg-(--celune-surface-hover) py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-(--celune-fg-muted) hover:bg-(--celune-surface)"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url = `${window.location.origin}${workspaceHref(`/projects/${project.id}`)}`;
                      navigator.clipboard.writeText(url);
                      setMenuOpen(false);
                    }}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-(--celune-danger) hover:bg-(--celune-danger)/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete?.(project);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete project
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProjectTableProps {
  projects: Project[];
  projectCounts: Record<string, { taskCount: number; doneCount: number; hasActiveTask?: boolean }>;
  groups?: ProjectGroup[];
  groupMap?: Record<string, string>;
  onToggleComplete?: (project: Project) => void;
  onDelete?: (project: Project) => void;
  onReorder?: (reordered: Project[]) => void;
  /** When provided, the parent manages DndContext and this table renders without its own */
  externalDnd?: {
    activeId: string | null;
  };
}

export function ProjectTable({
  projects,
  projectCounts,
  onToggleComplete,
  onDelete,
  onReorder,
  externalDnd,
}: ProjectTableProps) {
  const { transport } = useCelune();
  // Internal DnD state — only used when parent doesn't provide externalDnd
  const [internalActiveId, setInternalActiveId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Project[] | null>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const dndId = useId();

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setInternalActiveId(event.active.id as string);
    setSnapshot([...projectsRef.current]);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setInternalActiveId(null);

      if (!over || active.id === over.id) {
        setSnapshot(null);
        return;
      }

      const oldIndex = projectsRef.current.findIndex((p) => p.id === active.id);
      const newIndex = projectsRef.current.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        setSnapshot(null);
        return;
      }

      const reordered = arrayMove(projectsRef.current, oldIndex, newIndex);
      const payload = reordered.map((p, idx) => ({
        id: p.id,
        sort_order: (idx + 1) * 1000,
      }));

      // Optimistic update
      const withSortOrder = reordered.map((p, idx) => ({
        ...p,
        sort_order: (idx + 1) * 1000,
      }));
      onReorder?.(withSortOrder);

      try {
        if (!transport.projects.reorder) throw new Error('Reorder is not supported');
        await transport.projects.reorder(payload);
      } catch {
        if (snapshot) onReorder?.(snapshot);
      }

      setSnapshot(null);
    },
    [snapshot, onReorder, transport],
  );

  const activeId = externalDnd ? externalDnd.activeId : internalActiveId;
  const activeProject = activeId ? projects.find((p) => p.id === activeId) : null;

  const tableContent = (
    <>
      <div
        role="table"
        aria-label="Projects"
        className="grid overflow-hidden rounded-lg border border-(--celune-border) text-sm"
        style={{ gridTemplateColumns: GRID_COLS }}
      >
        {/* Header — uses subgrid to share parent columns */}
        <div
          role="row"
          className="col-[1/-1] grid items-center border-b border-(--celune-border) bg-(--celune-surface)"
          style={{ gridTemplateColumns: 'subgrid' }}
        >
          <div role="columnheader" className="py-3" />
          <div role="columnheader" className="py-3" />
          <div
            role="columnheader"
            className="px-4 py-3 text-left text-xs font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase"
          >
            Name
          </div>
          <div
            role="columnheader"
            className="px-4 py-3 text-left text-xs font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase"
          >
            Type
          </div>
          <div
            role="columnheader"
            className="px-4 py-3 text-left text-xs font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase"
          >
            Priority
          </div>
          <div role="columnheader" />
          <div
            role="columnheader"
            className="px-4 py-3 text-left text-xs font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase"
          >
            Status
          </div>
          <div
            role="columnheader"
            className="px-4 py-3 text-left text-xs font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase"
          >
            Category
          </div>
          <div
            role="columnheader"
            className="col-span-2 px-4 py-3 text-left text-xs font-(weight:--celune-font-weight-medium) tracking-wider text-(--celune-fg-muted) uppercase"
          >
            Progress
          </div>
          <div role="columnheader" className="py-3" />
        </div>

        {/* Rows — each row uses subgrid so cells align with header */}
        <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              counts={
                projectCounts[project.id] ?? { taskCount: 0, doneCount: 0, hasActiveTask: false }
              }
              onToggleComplete={onToggleComplete}
              onDelete={onDelete}
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay>
        {activeProject ? (
          <div className="overflow-hidden rounded-lg border text-sm" style={{ width: '100%' }}>
            <ProjectRow
              project={activeProject}
              counts={projectCounts[activeProject.id] ?? { taskCount: 0, doneCount: 0 }}
              isDragOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </>
  );

  // When parent manages DndContext, just render content without wrapping
  if (externalDnd) {
    return tableContent;
  }

  // Standalone mode — wrap in own DndContext
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {tableContent}
    </DndContext>
  );
}
