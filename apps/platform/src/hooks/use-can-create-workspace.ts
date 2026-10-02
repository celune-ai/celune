'use client';

import { useState, useEffect } from 'react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { usePlan } from './use-plan';

interface CanCreateWorkspaceResult {
  canCreate: boolean;
  currentCount: number;
  limit: number | null;
  loading: boolean;
}

export function useCanCreateWorkspace(): CanCreateWorkspaceResult {
  const { limits, isPlatformOwner, isLoading: planLoading } = usePlan();
  const [currentCount, setCurrentCount] = useState(0);
  const [countLoading, setCountLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCountLoading(true);

    fetchJson<{ id: string }[]>(apiUrl('/api/workspaces'))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setCurrentCount(data.length);
        }
      })
      .catch(() => {
        /* Non-critical — defaults to allowing creation */
      })
      .finally(() => {
        if (!cancelled) setCountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const maxWorkspaces = limits.max_workspaces;
  const canCreate = isPlatformOwner || maxWorkspaces === null || currentCount < maxWorkspaces;

  return {
    canCreate,
    currentCount,
    limit: maxWorkspaces,
    loading: planLoading || countLoading,
  };
}
