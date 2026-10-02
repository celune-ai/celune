'use client';

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCelune } from '../provider/context';

export const TASKS_QUERY_KEY = 'tasks';

export interface UseTasksQueryOptions {
  projectId?: string;
  /** Rows per page. Omitted, the server returns its full list (up to 2000 rows). */
  pageSize?: number;
  offset?: number;
  status?: string;
}

export function useTasksQuery(options: UseTasksQueryOptions | string = {}) {
  const { transport, workspaceId } = useCelune();

  const opts = typeof options === 'string' ? { projectId: options } : options;
  const { projectId, pageSize, offset = 0, status } = opts;

  return useQuery({
    queryKey: [
      TASKS_QUERY_KEY,
      workspaceId,
      projectId ?? 'all',
      pageSize ?? 'all',
      offset,
      status ?? 'all',
    ],
    queryFn: () => transport.tasks.list({ projectId, pageSize, offset, status }),
    enabled: !!workspaceId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTaskCountQuery(projectId?: string) {
  const { transport, workspaceId } = useCelune();

  return useQuery({
    queryKey: [TASKS_QUERY_KEY, 'count', workspaceId, projectId ?? 'all'],
    queryFn: async () => ({ count: await transport.tasks.count({ projectId }) }),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [TASKS_QUERY_KEY] });
}
