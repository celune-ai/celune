'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserRole, Permission } from '@/lib/roles';
import { hasPermission } from '@/lib/roles';

type RoleState = {
  role: UserRole | null;
  loading: boolean;
  error: string | null;
};

type UserRoleContextValue = RoleState & {
  can: (permission: Permission) => boolean;
  isOwner: boolean;
  isAdmin: boolean;
};

const UserRoleContext = createContext<UserRoleContextValue | null>(null);

export function UserRoleProvider({ children }: { children: ReactNode }) {
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

  const can = useCallback(
    (permission: Permission) => state.role !== null && hasPermission(state.role, permission),
    [state.role],
  );

  const value: UserRoleContextValue = useMemo(
    () => ({
      role: state.role,
      loading: state.loading,
      error: state.error,
      can,
      isOwner: state.role === 'owner',
      isAdmin: state.role === 'owner' || state.role === 'admin',
    }),
    [state.role, state.loading, state.error, can],
  );

  return <UserRoleContext.Provider value={value}>{children}</UserRoleContext.Provider>;
}

export function useUserRoleContext(): UserRoleContextValue {
  const ctx = useContext(UserRoleContext);
  if (!ctx) {
    throw new Error('useUserRoleContext must be used within UserRoleProvider');
  }
  return ctx;
}
