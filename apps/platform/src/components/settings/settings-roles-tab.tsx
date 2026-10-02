'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shield, Loader2, Info } from 'lucide-react';
import { Switch } from '@repo/ui/components/switch';
import { toast } from 'sonner';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { usePermissions } from '@/hooks/use-permissions';
import { PERMISSION_CATEGORIES } from '@repo/types';
import type { PermissionKey, PermissionCategory } from '@repo/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RoleRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface PermissionRow {
  id: string;
  key: PermissionKey;
  description: string | null;
  resource: string;
  action: string;
}

interface PermMatrixResponse {
  roles: RoleRow[];
  permissions: PermissionRow[];
  rolePermissions: Record<string, string[]>; // roleId → permissionId[]
  overrides: Record<string, boolean>; // "roleSlug:permKey" → enabled
  orgId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Display order and labels for permission categories */
const CATEGORY_ORDER: { key: PermissionCategory; label: string }[] = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'projects', label: 'Projects' },
  { key: 'agents', label: 'Agents' },
  { key: 'memory', label: 'Memory' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'users', label: 'Users' },
  { key: 'settings', label: 'Settings' },
  { key: 'billing', label: 'Billing' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'api_keys', label: 'API Keys' },
  { key: 'audit_log', label: 'Audit Log' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'voice', label: 'Voice' },
];

/** Friendly labels for permission actions */
const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  read: 'Read',
  update: 'Update',
  delete: 'Delete',
  assign: 'Assign',
  manage: 'Manage',
  invite: 'Invite',
  deactivate: 'Deactivate',
  configure: 'Configure',
  chat: 'Chat',
  export: 'Export',
  use: 'Use',
  transfer: 'Transfer',
  write: 'Write',
};

/** Role display order (left to right: highest access → lowest) */
const ROLE_ORDER = ['admin', 'member', 'viewer'];

/** Roles hidden from the grid (owner is always full access, shown in info banner) */
const HIDDEN_ROLES = new Set(['owner', 'platform_owner']);

/** Roles that cannot be modified by the owner (immutable in the grid) */
const IMMUTABLE_ROLES = new Set(['owner', 'platform_owner']);

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SettingsRolesTab() {
  const { activeWorkspace } = useWorkspace();
  const { available: hasPlanAccess } = useFeatureGate('roles_management');
  const { can, isOwner, isPlatformOwner } = usePermissions();
  const canManageRoles = isOwner || isPlatformOwner || can('settings:manage');

  const [data, setData] = useState<PermMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // "roleSlug:permKey" being saved

  const fetchMatrix = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const resp = await fetchJson<PermMatrixResponse>(
        apiUrl(`/api/org/permissions?workspace_id=${activeWorkspace.id}`),
      );
      setData(resp);
    } catch {
      toast.error('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-12 text-center">
        <Shield className="text-muted-foreground mx-auto h-8 w-8" />
        <p className="text-muted-foreground mt-3 text-sm">Unable to load permissions.</p>
      </div>
    );
  }

  const { roles, permissions, rolePermissions, overrides } = data;

  // Sort roles by display order, exclude hidden roles (owner, platform_owner)
  const sortedRoles = [...roles]
    .filter((r) => !HIDDEN_ROLES.has(r.slug) && ROLE_ORDER.includes(r.slug))
    .sort((a, b) => ROLE_ORDER.indexOf(a.slug) - ROLE_ORDER.indexOf(b.slug));

  // Build role slug → id map
  const roleIdBySlug = new Map(roles.map((r) => [r.slug, r.id]));

  // Group permissions by category
  const grouped = new Map<PermissionCategory, PermissionRow[]>();
  for (const perm of permissions) {
    const cat = PERMISSION_CATEGORIES[perm.key];
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(perm);
  }

  /** Check if a role has a specific permission (base + overrides) */
  function hasPermission(roleSlug: string, permKey: PermissionKey): boolean {
    // Check override first
    const overrideKey = `${roleSlug}:${permKey}`;
    if (overrides[overrideKey] !== undefined) {
      return overrides[overrideKey];
    }
    // Check base role_permissions
    const roleId = roleIdBySlug.get(roleSlug);
    if (!roleId) return false;
    const permIds = rolePermissions[roleId] ?? [];
    const perm = permissions.find((p) => p.key === permKey);
    return perm ? permIds.includes(perm.id) : false;
  }

  /** Toggle a permission override */
  async function togglePermission(roleSlug: string, permKey: PermissionKey) {
    if (!activeWorkspace?.id || !canManageRoles || IMMUTABLE_ROLES.has(roleSlug)) return;

    const overrideKey = `${roleSlug}:${permKey}`;
    const current = hasPermission(roleSlug, permKey);
    const newValue = !current;

    // Optimistic update
    setSaving(overrideKey);
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, overrides: { ...prev.overrides, [overrideKey]: newValue } };
    });

    try {
      await fetchJson(apiUrl('/api/org/permissions'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: activeWorkspace.id,
          role_slug: roleSlug,
          permission_key: permKey,
          enabled: newValue,
        }),
      });
    } catch {
      // Revert optimistic update
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, overrides: { ...prev.overrides, [overrideKey]: current } };
      });
      toast.error('Failed to update permission');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
          <Shield className="h-5 w-5" />
          Roles & Permissions
        </h2>
        <p className="text-muted-foreground text-sm">
          Configure what each role can access.{' '}
          {canManageRoles ? 'Toggle switches to customize.' : 'Read-only view.'}
        </p>
      </div>

      {/* Info banner */}
      {canManageRoles && (
        <div className="bg-surface-100 border-border flex items-start gap-3 rounded-lg border p-3">
          <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-muted-foreground text-xs">
            Owner permissions are always full access and are not shown here. Changes to roles take
            effect immediately for all workspace members with that role.
          </p>
        </div>
      )}

      {/* Permission grid */}
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="text-muted-foreground px-4 py-3 text-left text-xs font-medium tracking-wider uppercase">
                Permission
              </th>
              {sortedRoles.map((role) => (
                <th
                  key={role.id}
                  className="text-muted-foreground px-3 py-3 text-center text-xs font-medium tracking-wider uppercase"
                  style={{ minWidth: 96, width: '12%' }}
                >
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((cat) => {
              const catPerms = grouped.get(cat.key);
              if (!catPerms || catPerms.length === 0) return null;

              return (
                <CategorySection
                  key={cat.key}
                  label={cat.label}
                  permissions={catPerms}
                  roles={sortedRoles}
                  hasPermission={hasPermission}
                  togglePermission={togglePermission}
                  saving={saving}
                  canManageRoles={canManageRoles}
                  hasPlanAccess={hasPlanAccess}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category Section                                                   */
/* ------------------------------------------------------------------ */

function CategorySection({
  label,
  permissions,
  roles,
  hasPermission,
  togglePermission,
  saving,
  canManageRoles,
  hasPlanAccess,
}: {
  label: string;
  permissions: PermissionRow[];
  roles: RoleRow[];
  hasPermission: (roleSlug: string, permKey: PermissionKey) => boolean;
  togglePermission: (roleSlug: string, permKey: PermissionKey) => void;
  saving: string | null;
  canManageRoles: boolean;
  hasPlanAccess: boolean;
}) {
  return (
    <>
      {/* Category header row */}
      <tr className="bg-surface-75">
        <td
          colSpan={roles.length + 1}
          className="text-foreground px-4 py-2 text-xs font-semibold tracking-wider uppercase"
        >
          {label}
        </td>
      </tr>
      {/* Permission rows */}
      {permissions.map((perm) => {
        const action = perm.key.split(':')[1] ?? perm.key;
        return (
          <tr key={perm.id} className="border-border hover:bg-surface-50 border-b">
            <td className="px-4 py-2.5">
              <span className="text-foreground text-sm">{ACTION_LABELS[action] ?? action}</span>
              {perm.description && (
                <span className="text-muted-foreground ml-2 text-xs">{perm.description}</span>
              )}
            </td>
            {roles.map((role) => {
              const checked = hasPermission(role.slug, perm.key);
              const isImmutable = IMMUTABLE_ROLES.has(role.slug);
              const isSaving = saving === `${role.slug}:${perm.key}`;
              const canEdit = canManageRoles && !isImmutable && hasPlanAccess;

              return (
                <td
                  key={role.id}
                  className="px-3 py-2.5 text-center"
                  style={{ minWidth: 96, width: '12%' }}
                >
                  {isSaving ? (
                    <Loader2 className="text-muted-foreground mx-auto h-4 w-4 animate-spin" />
                  ) : (
                    <Switch
                      checked={checked}
                      disabled={!canEdit}
                      onCheckedChange={() => togglePermission(role.slug, perm.key)}
                      aria-label={`${role.name} can ${action} ${label.toLowerCase()}`}
                    />
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
      {/* Spacer row between category sections */}
      <tr>
        <td colSpan={roles.length + 1} className="h-10 p-0" />
      </tr>
    </>
  );
}
