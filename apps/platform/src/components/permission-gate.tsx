'use client';

import { type ReactNode } from 'react';
import { ShieldX } from 'lucide-react';
import { usePermissions } from '@/hooks/use-permissions';
import type { PermissionKey } from '@repo/types';

interface PermissionGateProps {
  /** Permission key(s) required. If multiple, ALL must be present. */
  permission: PermissionKey | PermissionKey[];
  children: ReactNode;
  /**
   * - `"hide"` — don't render children at all
   * - `"disable"` — render children with reduced opacity and a no-access overlay (default)
   */
  mode?: 'hide' | 'disable';
  /** Optional fallback to render when gated in hide mode */
  fallback?: ReactNode;
}

/**
 * Conditionally render or disable UI based on the user's resolved permissions.
 * This is the role-based gate (Layer 2). Use `FeatureGate` for plan-based gating (Layer 1).
 *
 * For dual-layer gating, nest FeatureGate outside and PermissionGate inside:
 * ```tsx
 * <FeatureGate feature="analytics">
 *   <PermissionGate permission="analytics:export">
 *     <ExportButton />
 *   </PermissionGate>
 * </FeatureGate>
 * ```
 */
export function PermissionGate({
  permission,
  children,
  mode = 'disable',
  fallback,
}: PermissionGateProps) {
  const { can, canAll, loading } = usePermissions();

  // While loading, render children to avoid layout shift
  if (loading) {
    return <>{children}</>;
  }

  const keys = Array.isArray(permission) ? permission : [permission];
  const hasAccess = keys.length === 1 ? can(keys[0]) : canAll(...keys);

  if (hasAccess) {
    return <>{children}</>;
  }

  if (mode === 'hide') {
    return fallback ? <>{fallback}</> : null;
  }

  // mode === 'disable'
  return (
    <div className="relative">
      <div
        className="pointer-events-none opacity-30 blur-[1px] select-none"
        aria-hidden="true"
        inert
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-surface-100 border-border flex flex-col items-center gap-2 rounded-lg border px-6 py-4 shadow-lg">
          <ShieldX size={20} className="text-foreground-muted" />
          <p className="text-foreground text-sm font-medium">Insufficient permissions</p>
          <p className="text-muted-foreground text-xs">Contact your workspace admin for access.</p>
        </div>
      </div>
    </div>
  );
}
