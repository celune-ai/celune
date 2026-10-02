'use client';

import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import type { Plan, PlanLimits } from '@repo/types';
import { PLAN_TIERS } from '@repo/types';

export interface PlanData {
  plan: Plan;
  limits: PlanLimits;
  features: string[];
  is_platform_owner: boolean;
  is_workspace_owner: boolean;
  /** The org's payment failed; access continues while Stripe retries. */
  past_due?: boolean;
}

const DEFAULT_PLAN: PlanData = {
  plan: 'cloud',
  limits: PLAN_TIERS.cloud,
  features: PLAN_TIERS.cloud.features,
  is_platform_owner: false,
  is_workspace_owner: false,
};

const PLAN_CACHE_PREFIX = 'celune:plan:';
const CHECKOUT_POLL_MS = 2000;
const CHECKOUT_POLL_TRIES = 15;

/** Stripe Checkout sends the buyer back with success=1 (see the checkout route). */
function isCheckoutReturn(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('success') === '1';
  } catch {
    return false;
  }
}

function getCachedPlan(workspaceId: string): PlanData | null {
  try {
    const raw = localStorage.getItem(`${PLAN_CACHE_PREFIX}${workspaceId}`);
    if (!raw) return null;
    return JSON.parse(raw) as PlanData;
  } catch {
    return null;
  }
}

function setCachedPlan(workspaceId: string, data: PlanData): void {
  try {
    localStorage.setItem(`${PLAN_CACHE_PREFIX}${workspaceId}`, JSON.stringify(data));
  } catch {
    // Storage full or unavailable
  }
}

function clearCachedPlan(workspaceId: string): void {
  try {
    localStorage.removeItem(`${PLAN_CACHE_PREFIX}${workspaceId}`);
  } catch {
    // Ignore
  }
}

export interface PlanContextValue extends PlanData {
  isLoading: boolean;
  hasFeature: (feature: string) => boolean;
  isPlatformOwner: boolean;
  isWorkspaceOwner: boolean;
  isPaid: boolean;
  /** The org has no active plan; the paywall sends the user to /subscribe. */
  isUnpaid: boolean;
  /** Workspaces have loaded and the user has none, so there is no plan to resolve. */
  hasNoWorkspace: boolean;
  refreshPlan: () => void;
}

const defaultContextValue: PlanContextValue = {
  ...DEFAULT_PLAN,
  isLoading: true,
  hasFeature: () => false,
  isPlatformOwner: false,
  isWorkspaceOwner: false,
  isPaid: false,
  isUnpaid: false,
  hasNoWorkspace: false,
  refreshPlan: () => {},
};

export const PlanContext = createContext<PlanContextValue>(defaultContextValue);

export function PlanProvider({ children }: { children: ReactNode }) {
  const { activeWorkspace, isLoading: workspacesLoading } = useWorkspace();
  const [planData, setPlanData] = useState<PlanData>(DEFAULT_PLAN);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshPlan = useCallback(() => {
    if (activeWorkspace?.id) clearCachedPlan(activeWorkspace.id);
    setRefreshKey((k) => k + 1);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const workspaceId = activeWorkspace.id;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const checkoutReturn = isCheckoutReturn();

    // Restore cached plan immediately to prevent flash of wrong tier. A cached unpaid plan is
    // never trusted (the org may have just subscribed), and nothing is on a checkout return.
    const cached = checkoutReturn ? null : getCachedPlan(workspaceId);
    if (cached && cached.plan !== 'unpaid') {
      setPlanData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    // Always fetch fresh data to stay in sync. After checkout the webhook can land after the
    // redirect back from Stripe, so stay loading and poll until the plan activates.
    const load = () => {
      fetchJson<PlanData>(apiUrl(`/api/workspaces/plan?workspace_id=${workspaceId}`))
        .then((data) => {
          if (cancelled || !data) return;
          setPlanData(data);
          setCachedPlan(workspaceId, data);
          if (checkoutReturn && data.plan === 'unpaid' && ++polls < CHECKOUT_POLL_TRIES) {
            pollTimer = setTimeout(load, CHECKOUT_POLL_MS);
            return;
          }
          setIsLoading(false);
        })
        .catch(() => {
          // Fail open — keep cached or default
          if (!cancelled) setIsLoading(false);
        });
    };
    load();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [activeWorkspace?.id, refreshKey]);

  // Listen for plan-changed events (e.g. access code redeemed, subscription updated)
  useEffect(() => {
    const handler = () => refreshPlan();
    window.addEventListener('celune:plan-changed', handler);
    return () => window.removeEventListener('celune:plan-changed', handler);
  }, [refreshPlan]);

  const hasFeature = (feature: string): boolean =>
    planData.is_platform_owner || planData.features.includes(feature);

  const isPlatformOwner = planData.is_platform_owner;
  const isWorkspaceOwner = planData.is_workspace_owner;
  const hasNoWorkspace = !workspacesLoading && !activeWorkspace;
  const isUnpaid = !hasNoWorkspace && planData.plan === 'unpaid';
  const isPaid = !isUnpaid;

  return (
    <PlanContext.Provider
      value={{
        ...planData,
        // Without a workspace there is no plan to wait for, so loading ends with the workspaces.
        isLoading: workspacesLoading || (!!activeWorkspace && isLoading),
        hasNoWorkspace,
        hasFeature,
        isPlatformOwner,
        isWorkspaceOwner,
        isPaid,
        isUnpaid,
        refreshPlan,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}
