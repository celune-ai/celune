'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import type { PermissionKey } from '@repo/types';

interface PermissionsState {
  permissions: Set<PermissionKey>;
  isOwner: boolean;
  isPlatformOwner: boolean;
  loading: boolean;
}

interface PermissionsResponse {
  permissions: PermissionKey[];
  isOwner: boolean;
  isPlatformOwner: boolean;
}

/* ------------------------------------------------------------------ */
/*  Module-level cache — shared across all usePermissions() consumers  */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60_000; // 1 minute

interface CacheEntry {
  state: PermissionsState;
  fetchedAt: number;
  listeners: Set<() => void>;
  inflight: Promise<void> | null;
}

const cache = new Map<string, CacheEntry>();

/** Clear all cached permissions — call on workspace switch to prevent stale data. */
export function clearPermissionsCache() {
  cache.clear();
}

const EMPTY_STATE: PermissionsState = {
  permissions: new Set(),
  isOwner: false,
  isPlatformOwner: false,
  loading: false,
};

function getOrCreateEntry(workspaceId: string): CacheEntry {
  let entry = cache.get(workspaceId);
  if (!entry) {
    entry = {
      state: { permissions: new Set(), isOwner: false, isPlatformOwner: false, loading: true },
      fetchedAt: 0,
      listeners: new Set(),
      inflight: null,
    };
    cache.set(workspaceId, entry);
  }
  return entry;
}

function notifyListeners(entry: CacheEntry) {
  for (const listener of entry.listeners) listener();
}

function fetchPermissions(workspaceId: string): Promise<void> {
  const entry = getOrCreateEntry(workspaceId);

  // If already fetching, return existing promise
  if (entry.inflight) return entry.inflight;

  // If cache is fresh, no-op
  if (entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve();
  }

  entry.state = { ...entry.state, loading: true };
  notifyListeners(entry);

  entry.inflight = fetchJson<PermissionsResponse>(
    apiUrl(`/api/user/permissions?workspace_id=${workspaceId}`),
  )
    .then((data) => {
      entry.state = {
        permissions: new Set(data.permissions),
        isOwner: data.isOwner,
        isPlatformOwner: data.isPlatformOwner,
        loading: false,
      };
      entry.fetchedAt = Date.now();
    })
    .catch(() => {
      entry.state = { ...entry.state, loading: false };
    })
    .finally(() => {
      entry.inflight = null;
      notifyListeners(entry);
    });

  return entry.inflight;
}

/**
 * Client-side hook that resolves the current user's granular permissions
 * for the active workspace. Uses the RBAC v2 permission system.
 *
 * Results are cached per workspace ID (1 min TTL) and shared across all
 * components that call this hook — multiple PermissionGate instances won't
 * trigger duplicate API calls.
 *
 * Returns:
 * - `can(key)` — check a single permission
 * - `canAll(...keys)` — check multiple permissions (all required)
 * - `canAny(...keys)` — check multiple permissions (any sufficient)
 * - `isOwner` / `isPlatformOwner` — role shortcuts
 * - `loading` — true while fetching
 */
export function usePermissions() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? '';

  const [state, setState] = useState<PermissionsState>(() => {
    if (!workspaceId) return EMPTY_STATE;
    return getOrCreateEntry(workspaceId).state;
  });

  // Subscribe to cache updates and trigger fetch
  useEffect(() => {
    if (!workspaceId) {
      setState(EMPTY_STATE);
      return;
    }

    const entry = getOrCreateEntry(workspaceId);

    // Sync current cache state immediately
    setState(entry.state);

    // Listen for future updates
    const listener = () => setState(entry.state);
    entry.listeners.add(listener);

    // Trigger fetch if needed
    fetchPermissions(workspaceId);

    return () => {
      entry.listeners.delete(listener);
    };
  }, [workspaceId]);

  const can = useCallback(
    (key: PermissionKey): boolean => {
      if (state.isOwner || state.isPlatformOwner) return true;
      return state.permissions.has(key);
    },
    [state.permissions, state.isOwner, state.isPlatformOwner],
  );

  const canAll = useCallback(
    (...keys: PermissionKey[]): boolean => {
      if (state.isOwner || state.isPlatformOwner) return true;
      return keys.every((k) => state.permissions.has(k));
    },
    [state.permissions, state.isOwner, state.isPlatformOwner],
  );

  const canAny = useCallback(
    (...keys: PermissionKey[]): boolean => {
      if (state.isOwner || state.isPlatformOwner) return true;
      return keys.some((k) => state.permissions.has(k));
    },
    [state.permissions, state.isOwner, state.isPlatformOwner],
  );

  return {
    can,
    canAll,
    canAny,
    permissions: state.permissions,
    isOwner: state.isOwner,
    isPlatformOwner: state.isPlatformOwner,
    loading: state.loading,
  };
}
