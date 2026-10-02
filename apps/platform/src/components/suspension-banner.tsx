'use client';

import { ShieldAlert } from 'lucide-react';
import { useWorkspace } from '@/providers/workspace-provider';
import { SUPPORT_EMAIL } from '@/lib/branding';

/**
 * Full-width alert banner shown when the active workspace has been suspended.
 * Suspension is indicated by `metadata.suspended_at` being set on the workspace.
 * This banner is not dismissible — the suspension must be resolved.
 */
export function SuspensionBanner() {
  const { activeWorkspace } = useWorkspace();

  const suspendedAt = activeWorkspace?.metadata?.suspended_at;
  if (!suspendedAt) return null;

  return (
    <div
      role="alert"
      className="border-destructive/20 bg-destructive/10 text-destructive flex items-center gap-3 border-b px-4 py-2 text-sm"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        This workspace has been suspended. All write operations are disabled. Please contact support
        at{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>{' '}
        for assistance.
      </span>
    </div>
  );
}
