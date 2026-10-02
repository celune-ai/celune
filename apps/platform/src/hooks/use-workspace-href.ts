'use client';

import { useParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * Returns a function that prefixes a path with the current workspace slug.
 * Usage: const href = workspaceHref('/tasks') → '/main/tasks'
 */
export function useWorkspaceHref() {
  const params = useParams<{ workspace: string }>();
  const slug = params.workspace ?? 'main';

  const workspaceHref = useCallback((path: string) => `/${slug}${path}`, [slug]);

  return { workspaceHref, slug };
}
