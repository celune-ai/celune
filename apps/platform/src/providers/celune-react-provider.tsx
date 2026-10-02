'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CeluneProvider, ReconnectBanner, type CeluneSlots } from '@celuneai/react';
import { apiUrl } from '@repo/db/api';
import { createClient } from '@repo/db/client';
import { AiTaskDialog } from '@/components/ai-task-dialog';
import { useMigrationStatus } from '@/components/migration-banner';
import { useCanEdit } from '@/hooks/use-can-edit';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { assigneeHandle } from '@/lib/assignee-handle';
import {
  EmbedTokenDenied,
  mintWithSessionRetry,
  startEmbedTokenRenewal,
  type EmbedToken,
} from '@/lib/celune-react/embed-token';
import { usePlan } from '@/hooks/use-plan';
import { EmbedLockedNotice } from '@/components/embed-locked-notice';
import { createSupabaseSubscribe } from '@/lib/celune-react/supabase-subscribe';
import { useWorkspace } from '@/providers/workspace-provider';

const SLOTS: CeluneSlots = { aiTaskDialog: AiTaskDialog };

function redirectToLogin() {
  const url = new URL('/login', window.location.origin);
  url.searchParams.set('reason', 'session_expired');
  window.location.href = url.toString();
}

/**
 * Next adapter for @celuneai/react: next/link, Supabase Realtime, and a host JWT
 * minted from the session. Data goes through /api/v1 with the default REST
 * transport, the same contract an embedding host uses.
 */
export function PlatformCeluneProvider({ children }: { children: ReactNode }) {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const canEdit = useCanEdit();
  const { id: userId, displayName, email } = useCurrentUser();
  const { workspaceHref } = useWorkspaceHref();
  const { reportMigrationIssue } = useMigrationStatus();
  const queryClient = useQueryClient();

  const [supabase] = useState(() => createClient());
  const [minted, setMinted] = useState<EmbedToken | null>(null);
  // 402 (no plan) or 403 (no access) for this workspace: stop minting and show the locked state.
  const [denied, setDenied] = useState<{
    workspaceId: string;
    plan: string;
    status: 402 | 403;
  } | null>(null);
  // A plan change (the org subscribed) is the only thing that can lift a 402, so it restarts minting.
  const { plan } = usePlan();

  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  useEffect(() => {
    if (!workspaceId) return;
    return startEmbedTokenRenewal(
      () => mintWithSessionRetry(workspaceId, () => supabase.auth.refreshSession()),
      setMinted,
      (status) => setDenied({ workspaceId, plan, status }),
    );
  }, [supabase, workspaceId, plan]);

  // A denial holds for the workspace and plan it was seen on; either changing lifts it.
  const deniedStatus =
    denied && denied.workspaceId === workspaceId && denied.plan === plan ? denied.status : null;
  const deniedRef = useRef(deniedStatus);
  deniedRef.current = deniedStatus;
  const planRef = useRef(plan);
  planRef.current = plan;

  // No token while denied, so the hooks go idle instead of calling the API into 402s.
  const token = !deniedStatus && minted && minted.workspaceId === workspaceId ? minted.token : null;

  const refreshToken = useCallback(async () => {
    if (!workspaceId || deniedRef.current) return null;
    let next: EmbedToken | null;
    try {
      next = await mintWithSessionRetry(workspaceId, () => supabase.auth.refreshSession());
    } catch (error) {
      if (!(error instanceof EmbedTokenDenied)) throw error;
      if (workspaceRef.current === workspaceId) {
        setDenied({ workspaceId, plan: planRef.current, status: error.status });
      }
      return null;
    }
    // Drop a result that lands after a workspace switch.
    if (!next || workspaceRef.current !== workspaceId) return null;
    setMinted(next);
    return next.token;
  }, [supabase, workspaceId]);

  const subscribe = useMemo(() => createSupabaseSubscribe(supabase), [supabase]);
  const currentUser = useMemo(
    () => ({ displayName, assignee: assigneeHandle({ id: userId, email }) }),
    [displayName, userId, email],
  );

  return (
    <CeluneProvider
      apiUrl={apiUrl('/api/v1')}
      token={token}
      refreshToken={refreshToken}
      subscribe={subscribe}
      Link={Link}
      // Hooks stay idle until the token for this workspace exists.
      workspaceId={token && workspaceId ? workspaceId : ''}
      href={workspaceHref}
      canEdit={canEdit}
      currentUser={currentUser}
      slots={SLOTS}
      onMigrationIssue={reportMigrationIssue}
      queryClient={queryClient}
      // A denied workspace shows the locked notice; reconnecting would only fail into a login.
      renderReconnect={(reconnect) =>
        deniedStatus ? null : (
          <ReconnectBanner
            onReconnect={async () => {
              const ok = await reconnect();
              if (!ok) redirectToLogin();
              return ok;
            }}
          />
        )
      }
    >
      {deniedStatus && <EmbedLockedNotice status={deniedStatus} />}
      {children}
    </CeluneProvider>
  );
}
