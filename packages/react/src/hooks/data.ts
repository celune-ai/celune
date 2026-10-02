'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCelune } from '../provider/context';
import type { CommentInput, ReorderItem, TaskInput, TaskPatch } from '../transport/types';
import { TASKS_QUERY_KEY } from './use-tasks-query';
import { PROJECTS_QUERY_KEY } from './use-projects-query';

function unsupported(name: string): never {
  throw new Error(`The configured transport does not support ${name}`);
}

function useInvalidate(root: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [root] });
}

// --- Tasks ---

export function useTask(id: string | null | undefined) {
  const { transport, workspaceId } = useCelune();
  return useQuery({
    queryKey: [TASKS_QUERY_KEY, workspaceId, 'one', id],
    queryFn: () => transport.tasks.get(id as string),
    enabled: !!id,
  });
}

export function useCreateTask() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(TASKS_QUERY_KEY);
  return useMutation({
    mutationFn: (input: TaskInput) => transport.tasks.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(TASKS_QUERY_KEY);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      transport.tasks.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(TASKS_QUERY_KEY);
  return useMutation({
    mutationFn: (id: string) => transport.tasks.remove(id),
    onSuccess: invalidate,
  });
}

export function useReorderTasks() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(TASKS_QUERY_KEY);
  return useMutation({
    mutationFn: (items: ReorderItem[]) =>
      transport.tasks.reorder ? transport.tasks.reorder(items) : unsupported('tasks.reorder'),
    onSuccess: invalidate,
  });
}

export function useInitiateTask() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(TASKS_QUERY_KEY);
  return useMutation({
    mutationFn: (id: string) =>
      transport.tasks.initiate ? transport.tasks.initiate(id) : unsupported('tasks.initiate'),
    onSuccess: invalidate,
  });
}

function useTaskRelation<K extends 'dependencies' | 'children' | 'spawned' | 'context' | 'usage'>(
  key: K,
  id: string | null | undefined,
) {
  const { transport, workspaceId } = useCelune();
  const fn = transport.tasks[key];
  return useQuery({
    queryKey: [TASKS_QUERY_KEY, workspaceId, key, id],
    queryFn: () =>
      (fn as (id: string) => ReturnType<NonNullable<typeof fn>>)(id as string) as Promise<
        Awaited<ReturnType<NonNullable<(typeof transport.tasks)[K]>>>
      >,
    enabled: !!id && !!fn,
  });
}

export const useTaskDependencies = (id: string | null | undefined) =>
  useTaskRelation('dependencies', id);
export const useTaskChildren = (id: string | null | undefined) => useTaskRelation('children', id);
export const useTaskFollowUps = (id: string | null | undefined) => useTaskRelation('spawned', id);
export const useTaskContext = (id: string | null | undefined) => useTaskRelation('context', id);
export const useTaskUsage = (id: string | null | undefined) => useTaskRelation('usage', id);

// --- Comments and activity ---

export function useTaskComments(taskId: string | null | undefined) {
  const { transport, workspaceId } = useCelune();
  return useQuery({
    queryKey: [TASKS_QUERY_KEY, workspaceId, 'comments', taskId],
    queryFn: () => transport.comments.list(taskId as string),
    enabled: !!taskId,
  });
}

export function useAddComment(taskId: string) {
  const { transport, workspaceId } = useCelune();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CommentInput) => transport.comments.create(taskId, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [TASKS_QUERY_KEY, workspaceId, 'comments', taskId] }),
  });
}

export function useTaskActivity(taskId: string | null | undefined, limit = 50) {
  const { transport, workspaceId } = useCelune();
  return useQuery({
    queryKey: [TASKS_QUERY_KEY, workspaceId, 'activity', taskId, limit],
    queryFn: () => transport.activity.list({ taskId: taskId as string, limit }),
    enabled: !!taskId,
  });
}

// --- Attachments ---

export function useTaskAttachments(taskId: string | null | undefined) {
  const { transport, workspaceId } = useCelune();
  return useQuery({
    queryKey: [TASKS_QUERY_KEY, workspaceId, 'attachments', taskId],
    queryFn: () => transport.attachments!.list(taskId as string),
    enabled: !!taskId && !!transport.attachments,
  });
}

export function useUploadAttachments(taskId: string) {
  const { transport, workspaceId, currentUser } = useCelune();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ files, onProgress }: { files: File[]; onProgress?: (f: number) => void }) =>
      transport.attachments
        ? transport.attachments.upload(taskId, files, {
            uploadedBy: currentUser.displayName,
            onProgress,
          })
        : unsupported('attachments.upload'),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [TASKS_QUERY_KEY, workspaceId, 'attachments', taskId] }),
  });
}

export function useDeleteAttachment(taskId: string) {
  const { transport, workspaceId } = useCelune();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      transport.attachments
        ? transport.attachments.remove(taskId, attachmentId)
        : unsupported('attachments.remove'),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [TASKS_QUERY_KEY, workspaceId, 'attachments', taskId] }),
  });
}

// --- Executions ---

export function useTaskExecutions(taskId: string | null | undefined, limit = 10) {
  const { transport, workspaceId } = useCelune();
  return useQuery({
    queryKey: [TASKS_QUERY_KEY, workspaceId, 'executions', taskId, limit],
    queryFn: () => transport.executions!.list({ taskId: taskId as string, limit }),
    enabled: !!taskId && !!transport.executions,
  });
}

export function useCancelExecution() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(TASKS_QUERY_KEY);
  return useMutation({
    mutationFn: (params: { taskId: string; workspaceId?: string }) =>
      transport.executions ? transport.executions.cancel(params) : unsupported('executions.cancel'),
    onSuccess: invalidate,
  });
}

// --- Projects ---

export function useReorderProjects() {
  const { transport } = useCelune();
  const invalidate = useInvalidate(PROJECTS_QUERY_KEY);
  return useMutation({
    mutationFn: (items: ReorderItem[]) =>
      transport.projects.reorder
        ? transport.projects.reorder(items)
        : unsupported('projects.reorder'),
    onSuccess: invalidate,
  });
}

export function useProjectProgressLog(projectId: string | null | undefined) {
  const { transport, workspaceId } = useCelune();
  return useQuery({
    queryKey: [PROJECTS_QUERY_KEY, workspaceId, 'progress-log', projectId],
    queryFn: () => transport.projects.progressLog!(projectId as string),
    enabled: !!projectId && !!transport.projects.progressLog,
  });
}
