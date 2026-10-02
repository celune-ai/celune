'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Switch } from '@repo/ui/components/switch';
import { Label } from '@repo/ui/components/label';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';

interface GitHubReviewSettings {
  pr_summary_comments: boolean;
  agent_code_review: boolean;
  auto_complete_review_tasks: boolean;
}

const TOGGLE_CONFIG = [
  {
    key: 'pr_summary_comments' as const,
    label: 'Post review summaries on pull requests',
    description: 'Agents post a summary comment when they finish reviewing a PR.',
  },
  {
    key: 'agent_code_review' as const,
    label: 'Enable agent code review collaboration',
    description: 'Agents leave inline review comments with severity-tagged findings.',
  },
  {
    key: 'auto_complete_review_tasks' as const,
    label: 'Auto-complete review tasks',
    description: 'Automatically mark review tasks as done when all findings are resolved.',
  },
] as const;

/**
 * GitHub PR review collaboration settings.
 *
 * Mount this inside the GitHub integration settings section or
 * the integrations tab. Reads/writes workspace metadata via
 * /api/settings/github-review.
 */
export function GitHubReviewSettings() {
  const { activeWorkspace } = useWorkspace();
  const [settings, setSettings] = useState<GitHubReviewSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const data = await fetchJson<GitHubReviewSettings>(
        apiUrl(`/api/settings/github-review?workspace_id=${activeWorkspace.id}`),
      );
      setSettings(data);
    } catch {
      // Graceful degradation — leave null
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleToggle = async (key: keyof GitHubReviewSettings, value: boolean) => {
    if (!activeWorkspace?.id || !settings) return;
    setSaving(key);

    // Optimistic update
    const prev = settings;
    setSettings({ ...settings, [key]: value });

    try {
      const updated = await fetchJson<GitHubReviewSettings>(
        apiUrl(`/api/settings/github-review?workspace_id=${activeWorkspace.id}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        },
      );
      setSettings(updated);
    } catch {
      // Revert on failure
      setSettings(prev);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-foreground-lighter h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-1">
      <h3 className="text-foreground text-sm font-medium">PR Review Collaboration</h3>
      <p className="text-foreground-lighter mb-4 text-xs">
        Control how agents interact with pull requests on GitHub.
      </p>
      <div className="space-y-4 pt-2">
        {TOGGLE_CONFIG.map(({ key, label, description }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor={key} className="text-foreground text-sm">
                {label}
              </Label>
              <p className="text-foreground-lighter text-xs">{description}</p>
            </div>
            <Switch
              id={key}
              checked={settings[key]}
              onCheckedChange={(checked) => handleToggle(key, checked)}
              disabled={saving !== null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
