'use client';

import { useState, useEffect } from 'react';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { usePlan } from './use-plan';

interface CanCreateAgentResult {
  canCreate: boolean;
  currentCount: number;
  limit: number | null;
  loading: boolean;
}

export function useCanCreateAgent(workspaceId: string | undefined): CanCreateAgentResult {
  const { limits, isPlatformOwner, isLoading: planLoading } = usePlan();
  const [currentCount, setCurrentCount] = useState(0);
  const [countLoading, setCountLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setCountLoading(true);

    fetchJson<{ agent_id: string; agent_type?: string }[]>(
      apiUrl(`/api/agents/configs?workspace_id=${workspaceId}`),
    )
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          // Only count AI agents toward plan limit (excludes human owner entries)
          setCurrentCount(data.filter((a) => a.agent_type !== 'human').length);
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
  }, [workspaceId]);

  const maxAgents = limits.max_agents;
  const canCreate = isPlatformOwner || maxAgents === null || currentCount < maxAgents;

  return {
    canCreate,
    currentCount,
    limit: maxAgents,
    loading: planLoading || countLoading,
  };
}
