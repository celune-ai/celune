'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCelune } from '../provider/context';

export const PROJECTS_QUERY_KEY = 'projects';

export function useProjectsQuery() {
  const { transport, workspaceId } = useCelune();

  return useQuery({
    queryKey: [PROJECTS_QUERY_KEY, workspaceId],
    queryFn: () => transport.projects.list(),
    enabled: !!workspaceId,
  });
}

export function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [PROJECTS_QUERY_KEY] });
}
