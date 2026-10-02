'use client';

import { useWorkspace } from '@/providers/workspace-provider';

/**
 * Returns true if the current user has edit permissions (owner, admin, member).
 * Returns false for viewers, who have read-only access.
 *
 * Use this to conditionally render create/edit/delete controls in the UI.
 * Note: The API layer also enforces this at the server level (403 for mutations).
 */
export function useCanEdit(): boolean {
  const { userRole } = useWorkspace();
  return userRole !== 'viewer';
}
