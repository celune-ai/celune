'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import type { Workspace } from '@repo/types';

/**
 * /onboarding — landing page for new users with no workspaces.
 *
 * If the user already has workspaces, redirects to their default workspace.
 * Otherwise, shows a simple "creating your workspace" state while the
 * onboarding wizard (in admin-layout) handles the full flow.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const workspaces = await fetchJson<Workspace[]>(apiUrl('/api/workspaces'));
        if (cancelled) return;

        if (Array.isArray(workspaces) && workspaces.length > 0) {
          // User already has workspaces — go to default
          const defaultWs = workspaces.find((w) => w.is_default) ?? workspaces[0];
          router.replace(`/${defaultWs.slug}`);
          return;
        }
      } catch {
        // If workspaces check fails, stay on page — wizard will handle
      }

      if (!cancelled) setChecking(false);
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-foreground-lighter text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-foreground text-2xl font-semibold">Welcome to Celune</h1>
        <p className="text-foreground-lighter text-sm">
          Complete the setup wizard to create your workspace and get started.
        </p>
      </div>
    </div>
  );
}
