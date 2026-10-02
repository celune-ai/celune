'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { toastWithUndo } from '../../lib/toast-undo';
import { cn } from '@repo/ui/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { ArrowRight, Upload } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import type { TaskAttachment } from '@repo/types';
import { useCelune } from '../../provider/context';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskAssignee,
  TaskMetadata,
  TaskComment,
  AgentMemory,
} from './types';
import { TaskDrawerHeader } from './task-drawer-header';
import { TaskDrawerMeta } from './task-drawer-meta';
import { TaskDrawerMarkdownSection } from './task-drawer-markdown-section';
import { TaskDrawerSubtasks } from './task-drawer-subtasks';
import { TaskDrawerFollowUps } from './task-drawer-follow-ups';
import { TaskDrawerAttachments } from './task-drawer-attachments';
import { TaskDrawerDetails } from './task-drawer-details';
import { TaskDrawerTimeline } from './task-drawer-timeline';
import { TaskDrawerComments } from './task-drawer-comments';
import { TaskDrawerExecution } from './task-drawer-execution';
import { TaskDrawerFooter } from './task-drawer-footer';
import { reportUploadError } from './upload-errors';
import { useElementClass } from '../../provider/appearance';
import { TaskDrawerSkeleton } from '../task-states';

export interface TaskDrawerProps {
  open: boolean;
  task: Task | null;
  taskLookup?: Map<string, Task>;
  onClose: () => void;
  onSaved: (task: Task) => void;
  onDeleted?: (id: string) => void;
  /** Shows the drawer skeleton while the host fetches the task. */
  loading?: boolean;
}

export function TaskDrawer({
  open,
  task,
  taskLookup = new Map(),
  onClose,
  onSaved,
  onDeleted,
  loading = false,
}: TaskDrawerProps) {
  const partClass = useElementClass('taskDrawer');
  const { transport, currentUser, canEdit, onMigrationIssue, slots } = useCelune();
  const currentUserName = currentUser.displayName;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('inbox');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [effort, setEffort] = useState<'S' | 'M' | 'L' | null>(null);
  const [assignee, setAssignee] = useState<TaskAssignee>('unassigned');
  const [dueDate, setDueDate] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [editingDescription, setEditingDescription] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [editingOutcome, setEditingOutcome] = useState(false);

  // UI state
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [claiming, setClaiming] = useState(false);

  // Error detail dialog
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Data state
  const [depTasks, setDepTasks] = useState<Task[]>([]);
  const [childTasks, setChildTasks] = useState<Task[]>([]);
  const [allChildrenComplete, setAllChildrenComplete] = useState(true);
  const [contextEntries, setContextEntries] = useState<AgentMemory[]>([]);
  const [lastComment, setLastComment] = useState<TaskComment | null>(null);
  const [followUpTasks, setFollowUpTasks] = useState<Task[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Scroll sentinel for sticky divider
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showStickyDivider, setShowStickyDivider] = useState(false);

  // IntersectionObserver for sticky divider
  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setShowStickyDivider(!entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open]);

  // Sync form state from task
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setStatus(task.status);
      setPriority(task.priority);
      setEffort(task.effort);
      setAssignee(task.assignee);
      setDueDate(task.due_date ?? '');
      setConfirmDelete(false);
      setDependsOn(task.depends_on ?? []);
      setEditingDescription(false);
      setOutcome(task.outcome ?? '');
      setEditingOutcome(false);

      // Fetch dependency task details
      if (task.depends_on && task.depends_on.length > 0) {
        if (transport.tasks.dependencies) {
          transport.tasks
            .dependencies(task.id)
            .then(setDepTasks)
            .catch(() => setDepTasks([]));
        } else {
          setDepTasks(task.depends_on.flatMap((id) => taskLookup.get(id) ?? []));
        }
      } else {
        setDepTasks([]);
      }

      // Fetch children
      if (!task.parent_id) {
        fetchChildren(task.id);
      } else {
        setChildTasks([]);
      }

      // Fetch follow-up tasks (spawned by this task)
      fetchFollowUps(task.id);

      // Fetch context entries
      fetchContext(task.id);

      // Fetch attachments
      fetchAttachments(task.id);
    }
  }, [task]);

  const saveField = useCallback(
    async (field: string, value: unknown) => {
      if (!task) return;
      try {
        const saved = await transport.tasks.update(task.id, { [field]: value });
        onSaved(saved);
        toast.success(`Updated ${field.replace(/_/g, ' ')}`);
      } catch (err) {
        const fullError = err instanceof Error ? err.message : String(err);
        console.error(`Failed to save ${field}:`, fullError);
        const isMissingColumn = fullError.includes('schema cache') || fullError.includes('column');
        if (isMissingColumn) onMigrationIssue?.();
        toast.error(`Failed to save ${field.replace(/_/g, ' ')}`, {
          description: (
            <span>
              {isMissingColumn
                ? 'Database migration required — run the pending SQL migration.'
                : 'Something went wrong.'}{' '}
              <button
                type="button"
                className="font-(weight:--celune-font-weight-medium) underline"
                onClick={() => setErrorDetail(fullError)}
              >
                View details
              </button>
            </span>
          ),
        });
      }
    },
    [task?.id, onSaved, transport, onMigrationIssue],
  );

  const fetchContext = useCallback(
    async (taskId: string) => {
      try {
        if (!transport.tasks.context) return setContextEntries([]);
        setContextEntries((await transport.tasks.context(taskId)) as unknown as AgentMemory[]);
      } catch {
        setContextEntries([]);
      }
    },
    [transport],
  );

  const fetchChildren = useCallback(
    async (taskId: string) => {
      try {
        if (!transport.tasks.children) return setChildTasks([]);
        const data = await transport.tasks.children(taskId);
        setChildTasks(data.children);
        setAllChildrenComplete(data.allComplete);
      } catch {
        setChildTasks([]);
      }
    },
    [transport],
  );

  const fetchFollowUps = useCallback(
    async (taskId: string) => {
      try {
        if (!transport.tasks.spawned) return setFollowUpTasks([]);
        setFollowUpTasks(await transport.tasks.spawned(taskId));
      } catch {
        setFollowUpTasks([]);
      }
    },
    [transport],
  );

  const fetchAttachments = useCallback(
    async (taskId: string) => {
      try {
        if (!transport.attachments) return setAttachments([]);
        setAttachments(await transport.attachments.list(taskId));
      } catch {
        setAttachments([]);
      }
    },
    [transport],
  );

  // Drag-and-drop file upload
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (!task || !transport.attachments || !e.dataTransfer?.files.length) return;

      try {
        const data = await transport.attachments.upload(task.id, Array.from(e.dataTransfer.files), {
          uploadedBy: currentUserName,
        });

        if (data.attachments.length) {
          setAttachments((prev) => [...data.attachments, ...prev]);
          toast.success(
            `Uploaded ${data.attachments.length} file${data.attachments.length > 1 ? 's' : ''}`,
          );
        }
        for (const err of data.errors) toast.error(`${err.file}: ${err.error}`);
      } catch (err) {
        reportUploadError(err);
      }
    },
    [task, transport, currentUserName],
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Handlers
  const handleDelete = async () => {
    if (!task) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    // Optimistic: close drawer and notify parent
    const deletedTask = task;
    onDeleted?.(task.id);
    onClose();
    setDeleting(false);
    setConfirmDelete(false);

    toastWithUndo('Task deleted', {
      action: async () => {
        await transport.tasks.remove(deletedTask.id);
      },
      onUndo: () => {
        // Re-add the task via onSaved callback
        onSaved(deletedTask);
      },
      undoMessage: 'Task restored',
      errorMessage: 'Failed to delete task',
    });
  };

  const handleInitiate = async () => {
    if (!task) return;
    setInitiating(true);
    try {
      if (!transport.tasks.initiate) throw new Error('Initiate is not supported');
      const updated = await transport.tasks.initiate(task.id);
      onSaved(updated);
      toast.success('Task initiated');
    } catch (err) {
      console.error('Failed to initiate task:', err);
      toast.error('Failed to initiate task');
    } finally {
      setInitiating(false);
    }
  };

  const handleCancelInitiate = async () => {
    if (!task) return;
    setInitiating(true);
    try {
      const currentMeta = (task.metadata ?? {}) as TaskMetadata;
      const {
        initiated: _i,
        initiated_at: _ia,
        initiated_by: _ib,
        active_session: _as,
        active_since: _asc,
        ...restMeta
      } = currentMeta;
      const previousStatus = currentMeta.pre_initiate_status ?? 'planning';
      const saved = await transport.tasks.update(task.id, {
        status: previousStatus,
        metadata: restMeta,
      });
      onSaved(saved);
      toast.success('Task activity cancelled');
    } catch (err) {
      console.error('Failed to cancel initiation:', err);
      toast.error('Failed to cancel');
    } finally {
      setInitiating(false);
    }
  };

  const handleClaim = async () => {
    const claimAs = currentUser.assignee;
    if (!task || !claimAs) return;
    setClaiming(true);
    try {
      const saved = await transport.tasks.update(task.id, {
        assignee: claimAs,
        status: task.status === 'inbox' ? 'scoping' : task.status,
      });
      onSaved(saved);
      setAssignee(claimAs as TaskAssignee);
      toast.success('Task claimed');
    } catch (err) {
      console.error('Failed to claim task:', err);
      toast.error('Failed to claim task');
    } finally {
      setClaiming(false);
    }
  };

  const handleUnclaim = async () => {
    if (!task) return;
    setClaiming(true);
    try {
      const saved = await transport.tasks.update(task.id, { assignee: 'unassigned' });
      onSaved(saved);
      setAssignee('unassigned');
      toast.success('Task unclaimed');
    } catch (err) {
      console.error('Failed to unclaim task:', err);
      toast.error('Failed to unclaim task');
    } finally {
      setClaiming(false);
    }
  };

  const handleDependsOnChange = useCallback(
    (next: string[]) => {
      setDependsOn(next);
      saveField('depends_on', next);
    },
    [saveField],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-(--celune-bg)/60 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={loading ? 'Loading task' : task ? `Edit task: ${task.title}` : 'Task details'}
        className={cn(
          'fixed top-0 right-0 z-[61] flex h-full w-2/5 min-w-[400px] flex-col border-l border-(--celune-border) bg-(--celune-bg) font-(family-name:--celune-font) text-(--celune-fg) shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
          partClass,
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* File drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-(--celune-bg)/90">
            <div className="pointer-events-none absolute inset-3 rounded-lg border-3 border-dashed border-(--celune-status-done)" />
            <div className="flex flex-col items-center gap-3">
              <Upload className="h-10 w-10 text-(--celune-status-done)" />
              <p className="text-lg font-(weight:--celune-font-weight-strong) text-(--celune-status-done)">
                Drop files to attach
              </p>
            </div>
          </div>
        )}
        {loading ? (
          <TaskDrawerSkeleton
            closeButton={
              <Button
                variant="ghost"
                size="md"
                onClick={onClose}
                aria-label="Close task drawer"
                title="Close"
                className="h-8 w-8 shrink-0 p-0"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            }
          />
        ) : (
          <>
            {/* Header */}
            <TaskDrawerHeader
              task={task}
              title={title}
              onTitleChange={canEdit ? setTitle : () => {}}
              onTitleSave={() => {
                if (canEdit && task && title.trim() && title.trim() !== task.title) {
                  saveField('title', title.trim());
                }
              }}
              onClose={onClose}
              onInitiate={transport.tasks.initiate ? handleInitiate : undefined}
              onCancelInitiate={handleCancelInitiate}
              onClaim={currentUser.assignee ? handleClaim : undefined}
              onUnclaim={handleUnclaim}
              initiating={initiating}
              claiming={claiming}
              canEdit={canEdit}
            />

            {/* Sticky divider (appears on scroll) */}
            <div
              className={cn(
                'border-b border-(--celune-border) transition-opacity duration-150',
                showStickyDivider ? 'opacity-100' : 'opacity-0',
              )}
            />

            {/* Scrollable body */}
            <div
              className="flex flex-1 flex-col overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              {/* Scroll sentinel */}
              <div ref={sentinelRef} className="h-0 w-full" />

              {slots.drawerBanner}

              {/* Metadata rows (2-col grid: Status/Priority/Assignee | Due date/Dependencies/Blocked) */}
              <TaskDrawerMeta
                status={status}
                priority={priority}
                assignee={assignee}
                dueDate={dueDate}
                dependsOn={dependsOn}
                depTasks={depTasks}
                taskLookup={taskLookup}
                task={task}
                canEdit={canEdit}
                onStatusChange={(v) => {
                  setStatus(v);
                  saveField('status', v);
                }}
                effort={effort}
                onPriorityChange={(v) => {
                  setPriority(v);
                  saveField('priority', v);
                }}
                onEffortChange={(v) => {
                  setEffort(v);
                  saveField('effort', v);
                }}
                onAssigneeChange={(v) => {
                  setAssignee(v);
                  saveField('assignee', v);
                }}
                onDueDateChange={(v) => {
                  setDueDate(v);
                  saveField('due_date', v || null);
                }}
                onDependsOnChange={handleDependsOnChange}
                onDepTasksChange={setDepTasks}
                onProjectChange={(v) => {
                  const update: Record<string, unknown> = { project_id: v };
                  if (v === null) {
                    update.status = 'inbox';
                  }
                  if (!task) return;
                  transport.tasks
                    .update(task.id, update)
                    .then((saved) => {
                      onSaved(saved);
                      if (v === null) setStatus('inbox');
                      toast.success(v ? 'Moved to project' : 'Moved to General Backlog');
                    })
                    .catch(() => toast.error('Failed to move task'));
                }}
              />

              {/* Execution progress panel */}
              {task && <TaskDrawerExecution task={task} />}

              {/* Description — collapsed by default on completed tasks */}
              <TaskDrawerMarkdownSection
                label="Description"
                value={description}
                onChange={setDescription}
                editing={editingDescription}
                onEditingChange={setEditingDescription}
                defaultOpen={task?.status !== 'done'}
                canEdit={canEdit}
                onSave={() => {
                  const trimmed = description.trim() || null;
                  if (task && trimmed !== (task.description ?? null)) {
                    saveField('description', trimmed);
                  }
                }}
              />

              {/* Outcome — open by default on completed tasks or when has content */}
              <TaskDrawerMarkdownSection
                label="Outcome"
                value={outcome}
                onChange={setOutcome}
                editing={editingOutcome}
                onEditingChange={setEditingOutcome}
                defaultOpen={task?.status === 'done' || !!task?.outcome}
                canEdit={canEdit}
                onSave={() => {
                  const trimmed = outcome.trim() || null;
                  if (task && trimmed !== (task.outcome ?? null)) {
                    saveField('outcome', trimmed);
                  }
                }}
              />

              {/* Follow-up tasks (spawned by this task) */}
              {task && (
                <TaskDrawerFollowUps
                  taskId={task.id}
                  followUpTasks={followUpTasks}
                  onTaskClick={(t) => {
                    // Navigate to the clicked follow-up task in the drawer
                    onSaved(t);
                  }}
                  onTasksChanged={setFollowUpTasks}
                  defaultOpen={task.status === 'done' && followUpTasks.length > 0}
                />
              )}

              {/* Attachments */}
              {task && transport.attachments && (
                <TaskDrawerAttachments
                  taskId={task.id}
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                  defaultOpen={attachments.length > 0}
                  uploadedBy={currentUserName}
                />
              )}

              {/* Subtasks */}
              {task?.subtasks && <TaskDrawerSubtasks subtasks={task.subtasks} />}

              {/* Collapsible details */}
              {task && (
                <TaskDrawerDetails
                  task={task}
                  childTasks={childTasks}
                  allChildrenComplete={allChildrenComplete}
                  contextEntries={contextEntries}
                />
              )}

              {/* Session trace timeline */}
              {task && <TaskDrawerTimeline task={task} />}

              {/* Comments / Activity feed (input is in footer) */}
              {task && <TaskDrawerComments taskId={task.id} externalComment={lastComment} />}
            </div>

            {/* Footer (comment input + action buttons) */}
            <TaskDrawerFooter
              taskId={task?.id ?? null}
              task={task}
              currentUser={currentUserName}
              deleting={deleting}
              confirmDelete={confirmDelete}
              onDelete={handleDelete}
              onCancelDelete={() => setConfirmDelete(false)}
              onCommentAdded={setLastComment}
              canEdit={canEdit}
            />
          </>
        )}
      </div>

      {/* Error detail dialog */}
      <Dialog open={errorDetail !== null} onOpenChange={() => setErrorDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Error Details</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-(--celune-surface-hover) p-4 text-xs break-all whitespace-pre-wrap text-(--celune-fg)">
            {errorDetail}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
