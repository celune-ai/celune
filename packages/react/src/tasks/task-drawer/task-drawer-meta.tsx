'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Circle,
  Signal,
  User,
  Users,
  Calendar,
  FolderOpen,
  Gauge,
  Layers,
  X,
  Plus,
  CheckCircle2,
  Ban,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { Badge } from '../../components/badge';
import { Input } from '@repo/ui/components/input';
import { cn } from '@repo/ui/utils';
import { useCelune } from '../../provider/context';
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_ASSIGNEES,
  TASK_ASSIGNEE_LABELS,
} from '@repo/types';
import { AGENT_COLORS } from '../../lib/agent-colors';
import { priorityLabels } from '../../lib/constants';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { DatePickerCalendar } from '../../components/date-picker-calendar';
import type { Task, TaskStatus, TaskPriority, TaskAssignee } from './types';

type Effort = 'S' | 'M' | 'L' | null;

const EFFORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'S', label: 'S — Small' },
  { value: 'M', label: 'M — Medium' },
  { value: 'L', label: 'L — Large' },
];

/** Inline sprint editor — reads from task.metadata.sprint, writes via API */
function SprintInput({ task, canEdit }: { task: Task | null; canEdit: boolean }) {
  const { transport } = useCelune();
  const meta = (task?.metadata ?? {}) as Record<string, unknown>;
  const currentSprint = typeof meta.sprint === 'number' ? meta.sprint : null;
  const [value, setValue] = useState(currentSprint != null ? String(currentSprint) : '');
  const [saving, setSaving] = useState(false);

  // Sync when task changes externally
  useEffect(() => {
    const m = (task?.metadata ?? {}) as Record<string, unknown>;
    const s = typeof m.sprint === 'number' ? m.sprint : null;
    setValue(s != null ? String(s) : '');
  }, [task?.id, task?.metadata]);

  const save = useCallback(
    async (newValue: string) => {
      if (!task) return;
      const trimmed = newValue.trim();
      const newSprint = trimmed === '' ? null : parseInt(trimmed, 10);
      if (trimmed !== '' && (isNaN(newSprint as number) || (newSprint as number) < 0)) return;

      // Skip if unchanged
      if (newSprint === currentSprint) return;

      setSaving(true);
      try {
        const existingMeta = (task.metadata ?? {}) as Record<string, unknown>;
        const updatedMeta = { ...existingMeta };
        if (newSprint == null) {
          delete updatedMeta.sprint;
        } else {
          updatedMeta.sprint = newSprint;
        }
        await transport.tasks.update(task.id, { metadata: updatedMeta });
      } catch {
        // Revert
        setValue(currentSprint != null ? String(currentSprint) : '');
      } finally {
        setSaving(false);
      }
    },
    [task, currentSprint, transport],
  );

  if (!canEdit) {
    return (
      <span className="meta-input text-xs text-(--celune-fg)">
        {currentSprint != null ? (
          `Sprint ${currentSprint}`
        ) : (
          <span className="text-(--celune-fg-muted)">None</span>
        )}
      </span>
    );
  }

  return (
    <input
      type="number"
      min={0}
      max={99}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => save(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      placeholder="None"
      disabled={saving}
      className="meta-input w-full [appearance:textfield] text-xs text-(--celune-fg) placeholder:text-(--celune-fg-muted) focus:outline-none disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

interface ProjectOption {
  id: string;
  name: string;
}

interface TaskDrawerMetaProps {
  status: TaskStatus;
  priority: TaskPriority;
  effort: Effort;
  assignee: TaskAssignee;
  dueDate: string;
  dependsOn: string[];
  depTasks: Task[];
  taskLookup: Map<string, Task>;
  task: Task | null;
  canEdit?: boolean;
  onStatusChange: (v: TaskStatus) => void;
  onPriorityChange: (v: TaskPriority) => void;
  onEffortChange: (v: Effort) => void;
  onAssigneeChange: (v: TaskAssignee) => void;
  onDueDateChange: (v: string) => void;
  onDependsOnChange: (v: string[]) => void;
  onDepTasksChange: (v: Task[]) => void;
  onProjectChange: (v: string | null) => void;
}

const STATUS_DOTS: Record<TaskStatus, string> = {
  backlog: 'bg-(--celune-status-backlog)',
  inbox: 'bg-(--celune-status-inbox)',
  scoping: 'bg-(--celune-status-scoping)',
  planning: 'bg-(--celune-status-planning)',
  in_progress: 'bg-(--celune-status-in-progress)',
  review: 'bg-(--celune-status-review)',
  done: 'bg-(--celune-status-done)',
};

/** Meta row: label on the left, value on the right */
function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex w-[120px] shrink-0 items-center gap-2 text-xs"
        style={{ color: 'var(--celune-fg-muted)' }}
      >
        {icon}
        <span>{label}</span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function TaskDrawerMeta({
  status,
  priority,
  effort,
  assignee,
  dueDate,
  dependsOn,
  depTasks,
  taskLookup,
  task,
  canEdit = true,
  onStatusChange,
  onPriorityChange,
  onEffortChange,
  onAssigneeChange,
  onDueDateChange,
  onDependsOnChange,
  onDepTasksChange,
  onProjectChange,
}: TaskDrawerMetaProps) {
  const { transport } = useCelune();
  const [showDepPicker, setShowDepPicker] = useState(false);
  const [depSearch, setDepSearch] = useState('');
  const [depActiveIndex, setDepActiveIndex] = useState(-1);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const depListRef = useRef<HTMLDivElement>(null);
  const depListboxId = 'dep-search-listbox';

  useEffect(() => {
    transport.projects
      .list()
      .then((data) => setProjects(data as ProjectOption[]))
      .catch(() => setProjects([]));
  }, [transport]);

  const filteredDepTasks = Array.from(taskLookup.values())
    .filter(
      (t) =>
        t.id !== task?.id &&
        !dependsOn.includes(t.id) &&
        t.title.toLowerCase().includes(depSearch.toLowerCase()),
    )
    .slice(0, 10);

  const selectDep = useCallback(
    (t: Task) => {
      onDependsOnChange([...dependsOn, t.id]);
      onDepTasksChange([...depTasks, t]);
      setShowDepPicker(false);
      setDepSearch('');
      setDepActiveIndex(-1);
    },
    [dependsOn, depTasks, onDependsOnChange, onDepTasksChange],
  );

  const agentColor = AGENT_COLORS[assignee];

  const formatDueLabel = (d: string) => {
    if (!d) return 'None';
    const date = new Date(d + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="px-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {/* Row 1: Status | Due date */}
        <MetaRow icon={<Circle className="h-3.5 w-3.5" />} label="Status">
          <Select
            value={status}
            onValueChange={(v) => onStatusChange(v as TaskStatus)}
            disabled={!canEdit}
          >
            <SelectTrigger className="meta-input w-full cursor-pointer text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', STATUS_DOTS[s])} />
                    {TASK_STATUS_LABELS[s]}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MetaRow>

        <MetaRow icon={<Calendar className="h-3.5 w-3.5" />} label="Due date">
          <DatePickerCalendar
            value={dueDate || null}
            onChange={(v) => canEdit && onDueDateChange(v ?? '')}
            open={canEdit ? datePickerOpen : false}
            onOpenChange={canEdit ? setDatePickerOpen : undefined}
          >
            <button
              type="button"
              disabled={!canEdit}
              className="meta-input w-full cursor-pointer text-left text-xs text-(--celune-fg) disabled:cursor-default"
            >
              {dueDate ? (
                formatDueLabel(dueDate)
              ) : (
                <span className="text-(--celune-fg-muted)">None</span>
              )}
            </button>
          </DatePickerCalendar>
        </MetaRow>

        {/* Row 2: Priority | Dependencies */}
        <MetaRow icon={<Signal className="h-3.5 w-3.5" />} label="Priority">
          <Select
            value={priority}
            onValueChange={(v) => onPriorityChange(v as TaskPriority)}
            disabled={!canEdit}
          >
            <SelectTrigger className="meta-input w-full cursor-pointer text-xs shadow-none">
              <SelectValue>{priorityLabels[priority] ?? priority}</SelectValue>
            </SelectTrigger>
            <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {priorityLabels[p] ?? p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MetaRow>

        {/* Row 2 right: Assignee */}
        <MetaRow icon={<User className="h-3.5 w-3.5" />} label="Assignee">
          <Select
            value={assignee}
            onValueChange={(v) => onAssigneeChange(v as TaskAssignee)}
            disabled={!canEdit}
          >
            <SelectTrigger className="meta-input w-full cursor-pointer text-xs shadow-none">
              {assignee !== 'unassigned' && agentColor ? (
                <Badge
                  variant="brand"
                  className="text-xs"
                  style={{
                    backgroundColor: agentColor.color,
                    color: 'var(--celune-on-status)',
                    borderColor: agentColor.color,
                  }}
                >
                  {TASK_ASSIGNEE_LABELS[assignee] ?? assignee}
                </Badge>
              ) : (
                <SelectValue />
              )}
            </SelectTrigger>
            <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
              {TASK_ASSIGNEES.map((a) => {
                const color = AGENT_COLORS[a];
                return (
                  <SelectItem key={a} value={a} className="text-xs">
                    <div className="flex items-center gap-2">
                      {color && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: color.color }}
                        />
                      )}
                      {TASK_ASSIGNEE_LABELS[a]}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </MetaRow>

        {/* Row 3 left: Effort */}
        <MetaRow icon={<Gauge className="h-3.5 w-3.5" />} label="Effort">
          <Select
            value={effort ?? 'none'}
            onValueChange={(v) => onEffortChange(v === 'none' ? null : (v as 'S' | 'M' | 'L'))}
            disabled={!canEdit}
          >
            <SelectTrigger className="meta-input w-full cursor-pointer text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
              {EFFORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MetaRow>

        {/* Row 3 right: Sprint */}
        <MetaRow icon={<Layers className="h-3.5 w-3.5" />} label="Sprint">
          <SprintInput task={task} canEdit={canEdit} />
        </MetaRow>
      </div>

      {/* Blocked by (full-width, below grid) */}
      <div className="mt-2 px-0">
        <MetaRow icon={<Ban className="h-3.5 w-3.5" />} label="Blocked by">
          <div className="meta-input flex w-full flex-col justify-center">
            {depTasks.length > 0 && (
              <div className="mb-1 space-y-1">
                {depTasks.map((dep) => (
                  <div key={dep.id} className="flex items-center gap-1.5 text-xs">
                    {dep.status === 'done' ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0 text-(--celune-status-done)" />
                    ) : (
                      <Circle className="h-3 w-3 shrink-0 text-(--celune-fg-muted)" />
                    )}
                    <span
                      className={cn(
                        'truncate',
                        dep.status === 'done' && 'text-(--celune-fg-muted) line-through',
                      )}
                    >
                      {dep.title}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = dependsOn.filter((id) => id !== dep.id);
                          onDependsOnChange(next);
                          onDepTasksChange(depTasks.filter((t) => t.id !== dep.id));
                        }}
                        className="ml-auto shrink-0 text-(--celune-fg-muted) hover:text-(--celune-fg)"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEdit && showDepPicker ? (
              <div className="space-y-1.5">
                <Input
                  value={depSearch}
                  onChange={(e) => {
                    setDepSearch(e.target.value);
                    setDepActiveIndex(-1);
                  }}
                  placeholder="Search tasks..."
                  className="h-7 text-xs"
                  autoFocus
                  role="combobox"
                  aria-expanded={filteredDepTasks.length > 0}
                  aria-controls={depListboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    depActiveIndex >= 0 ? `dep-option-${depActiveIndex}` : undefined
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowDepPicker(false);
                      setDepSearch('');
                      setDepActiveIndex(-1);
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setDepActiveIndex((prev) =>
                        prev < filteredDepTasks.length - 1 ? prev + 1 : 0,
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setDepActiveIndex((prev) =>
                        prev > 0 ? prev - 1 : filteredDepTasks.length - 1,
                      );
                    } else if (e.key === 'Enter' && depActiveIndex >= 0) {
                      e.preventDefault();
                      const selected = filteredDepTasks[depActiveIndex];
                      if (selected) selectDep(selected);
                    }
                  }}
                />
                <div
                  ref={depListRef}
                  id={depListboxId}
                  role="listbox"
                  aria-label="Task search results"
                  className="max-h-32 overflow-y-auto rounded-md border border-(--celune-border)"
                >
                  {filteredDepTasks.map((t, i) => (
                    <button
                      key={t.id}
                      id={`dep-option-${i}`}
                      type="button"
                      role="option"
                      aria-selected={i === depActiveIndex}
                      className={cn(
                        'w-full px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-(--celune-surface-hover)',
                        i === depActiveIndex && 'bg-(--celune-surface-hover)',
                      )}
                      onClick={() => selectDep(t)}
                    >
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                  {filteredDepTasks.length === 0 && (
                    <p className="px-2.5 py-1.5 text-xs text-(--celune-fg-muted)">
                      No matching tasks
                    </p>
                  )}
                </div>
              </div>
            ) : canEdit ? (
              <button
                type="button"
                onClick={() => setShowDepPicker(true)}
                className="flex items-center gap-1 text-xs text-(--celune-fg-muted) transition-colors hover:text-(--celune-fg)"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            ) : null}
          </div>
        </MetaRow>
      </div>

      {/* Project (full-width, below grid) */}
      <div className="mt-2">
        <MetaRow icon={<FolderOpen className="h-3.5 w-3.5" />} label="Project">
          <Select
            value={task?.project_id ?? '__backlog__'}
            onValueChange={(v) => onProjectChange(v === '__backlog__' ? null : v)}
            disabled={!canEdit}
          >
            <SelectTrigger className="meta-input w-full cursor-pointer text-xs shadow-none">
              <SelectValue placeholder="General Backlog" />
            </SelectTrigger>
            <SelectContent className="border-(--celune-border) bg-(--celune-surface-raised)">
              <SelectItem value="__backlog__" className="text-xs">
                General Backlog
              </SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MetaRow>
      </div>
    </div>
  );
}
