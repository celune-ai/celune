'use client';

import { useEffect, useState } from 'react';
import type { UserRole, Permission } from '@/lib/roles';
import { hasPermission } from '@/lib/roles';

type RoleState = {
  role: UserRole | null;
  loading: boolean;
  error: string | null;
};

/**
 * Client-side hook that fetches the current user's role from /api/users/me/role.
 * Returns the role plus convenience helpers for permission checks.
 */
export function useUserRole() {
  const [state, setState] = useState<RoleState>({
    role: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchRole() {
      try {
        const res = await fetch('/api/user/role');
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error((json as { error?: string }).error ?? 'Failed to fetch role');
        }
        const json = (await res.json()) as { role: UserRole };
        if (!cancelled) {
          setState({ role: json.role, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            role: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    void fetchRole();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    role: state.role,
    loading: state.loading,
    error: state.error,
    can: (permission: Permission) => state.role !== null && hasPermission(state.role, permission),
  };
}
