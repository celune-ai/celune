'use client';

import { useMemo } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';

/**
 * Returns a query-string snippet for workspace-scoped API calls.
 *
 * - Child workspace → `workspace_id=<id>`
 * - Main workspace  → `workspace_ids=<all accessible ids>` (aggregated view)
 * - No workspace    → empty string
 *
 * Usage:
 *   const wsParam = useWorkspaceApiParam();
 *   fetchJson(apiUrl(`/api/analytics/velocity?weeks=12${wsParam ? `&${wsParam}` : ''}`))
 *
 * Or for the first param:
 *   fetchJson(apiUrl(`/api/tasks?${wsParam}`))
 */
export function useWorkspaceApiParam(): string {
  const { activeWorkspace, workspaces, isMainWorkspace } = useWorkspace();

  return useMemo(() => {
    if (!activeWorkspace) return '';

    if (isMainWorkspace) {
      const ids = workspaces.map((w) => w.id).join(',');
      return ids ? `workspace_ids=${ids}` : '';
    }

    return `workspace_id=${activeWorkspace.id}`;
  }, [activeWorkspace, workspaces, isMainWorkspace]);
}
