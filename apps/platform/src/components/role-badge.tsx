'use client';

import { useUserRole } from '@/hooks/use-user-role';
import type { UserRole } from '@/lib/roles';

/**
 * Role-specific styling: subtle pill with muted colours that fit the dark theme.
 * Uses CSS custom properties from theme.css where possible.
 */
const ROLE_STYLES: Record<UserRole, string> = {
  platform_owner: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
  owner: 'bg-purple-500/15 text-purple-400 ring-purple-500/25',
  admin: 'bg-blue-500/15 text-blue-400 ring-blue-500/25',
  member: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25',
  viewer: 'bg-gray-500/15 text-gray-400 ring-gray-500/25',
};

const ROLE_LABELS: Record<UserRole, string> = {
  platform_owner: 'Platform Owner',
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  platform_owner: 'Platform-wide superadmin with all permissions',
  owner: 'Full control over the organization',
  admin: 'Can manage projects, tasks, and agents',
  member: 'Can create and update tasks',
  viewer: 'Read-only access',
};

/**
 * Small pill badge showing the current user's role.
 * Gracefully degrades: shows nothing while loading or on error.
 */
export function RoleBadge() {
  const { role, loading, error } = useUserRole();

  if (loading || error || !role) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset ${ROLE_STYLES[role]}`}
      title={`${ROLE_LABELS[role]} — ${ROLE_DESCRIPTIONS[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
