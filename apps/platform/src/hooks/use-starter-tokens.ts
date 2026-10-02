'use client';

import { useState, useEffect } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';

/**
 * Starter tokens: the shared host model-key budget a workspace uses before it adds
 * its own key. This is separate from billing (Cloud has no trial). The API route and
 * the workspaces columns keep their original trial_* names.
 */
interface StarterTokensData {
  trial_token_budget: number;
  trial_tokens_used: number;
  trial_tokens_remaining: number;
  trial_exhausted: boolean;
  trial_percent_used: number;
  has_provider_key: boolean;
  requires_key: boolean;
}

/**
 * Fetches the starter token budget for the current workspace.
 * Used by ProviderKeyBanner to show BYOK prompts.
 */
export function useStarterTokens() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<StarterTokensData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const wsId = activeWorkspace.id;

    async function load() {
      try {
        const result = await fetchJson<StarterTokensData>(`/api/trial-status?workspace_id=${wsId}`);
        if (!cancelled) setData(result);
      } catch {
        // Silently fail — banner just won't show
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  return { data, isLoading };
}
