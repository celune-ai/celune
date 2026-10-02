'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Key, ArrowRight, AlertTriangle, X } from 'lucide-react';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useStarterTokens } from '@/hooks/use-starter-tokens';
import { useWorkspace } from '@/providers/workspace-provider';
import { apiUrl } from '@repo/db/api';

/**
 * Banner prompting users to add their own API key (BYOK) or fix a broken one.
 *
 * Shown when:
 * - Starter tokens are > 50% used (informational, green)
 * - Starter tokens are > 80% used (warning, amber)
 * - Starter tokens are used up and no BYOK key exists (blocking, red)
 * - User's API key has an error (insufficient credits, invalid, etc.) (red)
 *
 * Hidden for platform owners and users who already have a working provider key.
 */
export function ProviderKeyBanner() {
  const { workspaceHref } = useWorkspaceHref();
  const { data, isLoading } = useStarterTokens();
  const { activeWorkspace } = useWorkspace();
  const [keyError, setKeyError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Check for provider key errors from generation
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    fetch(apiUrl(`/api/onboarding/generate-projects?workspace_id=${activeWorkspace.id}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.error && d?.status === 'error') {
          const msg = d.error as string;
          if (msg.includes('credit') || msg.includes('API key') || msg.includes('provider')) {
            setKeyError(msg);
          }
        }
      })
      .catch(() => {});
  }, [activeWorkspace?.id]);

  if (dismissed) return null;

  // Provider key error banner (red) — user has a key but it's not working
  if (keyError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1">{keyError}</span>
        <Link
          href={workspaceHref('/settings?tab=api-keys')}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
        >
          Resolve
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-0.5 text-red-400/50 transition-colors hover:text-red-400"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Starter token usage banner (the API reports it under trial_* names)
  if (isLoading || !data) return null;
  if (data.has_provider_key) return null;

  const pct = data.trial_percent_used;
  if (pct < 50) return null;

  const exhausted = data.trial_exhausted;
  const isUrgent = pct >= 80;

  const colorClasses = exhausted
    ? 'border-destructive/20 bg-destructive/10 text-destructive'
    : isUrgent
      ? 'border-warning/20 bg-warning/10 text-warning'
      : 'border-brand-400/20 bg-brand-default/10 text-brand-default';

  const buttonClasses = exhausted
    ? 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20'
    : isUrgent
      ? 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20'
      : 'border-brand-400/30 bg-brand-default/10 text-brand-default hover:bg-brand-default/20';

  const Icon = exhausted ? AlertTriangle : Key;

  const message = exhausted
    ? 'Starter tokens used up. Add your API key to continue using AI features.'
    : isUrgent
      ? `${100 - pct}% of starter tokens remaining. Add your API key to avoid interruption.`
      : `${100 - pct}% of starter tokens remaining. Connect your own API key for unlimited usage.`;

  return (
    <div
      role="status"
      className={`flex items-center gap-3 border-b px-4 py-2 text-sm ${colorClasses}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <Link
        href={workspaceHref('/settings?tab=api-keys')}
        className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors ${buttonClasses}`}
      >
        Add API key <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
