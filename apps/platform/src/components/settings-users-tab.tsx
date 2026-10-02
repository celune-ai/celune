'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Users,
  Loader2,
  Search,
  ChevronDown,
  Shield,
  ShieldOff,
  RotateCw,
  XCircle,
  Trash2,
  Mail,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastWithUndo } from '@celuneai/react/utils';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import type { UserRole } from '@/lib/roles';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface ManagedUser {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  last_sign_in_at: string | null;
  last_active_at: string | null;
  is_active: boolean;
}

interface PendingInvitation {
  id: string;
  email: string;
  invited_at: string;
  role: string;
  created_at: string;
}

interface SettingsUsersTabProps {
  currentUserId: string | null;
  currentUserRole: UserRole;
  isOwner: boolean;
  workspaceId: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  owner: {
    bg: 'var(--color-brand)',
    border: 'var(--color-brand)',
    text: 'var(--color-foreground-contrast)',
  },
  admin: {
    bg: 'var(--color-warning)',
    border: 'var(--color-warning)',
    text: 'var(--color-foreground-contrast)',
  },
  member: {
    bg: 'var(--color-brand-400)',
    border: 'var(--color-brand-400)',
    text: 'var(--color-foreground-contrast)',
  },
  viewer: {
    bg: 'var(--color-border-strong)',
    border: 'var(--color-border-strong)',
    text: 'var(--color-foreground)',
  },
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** Roles the current user can assign to others (hierarchy-based). */
function assignableRoles(actorRole: UserRole): UserRole[] {
  if (actorRole === 'owner') return ['admin', 'member', 'viewer'];
  if (actorRole === 'admin') return ['member', 'viewer'];
  return [];
}

function canActorManageTarget(actorRole: UserRole, targetRole: UserRole): boolean {
  const h: Record<string, number> = { owner: 100, admin: 75, member: 50, viewer: 25 };
  return (h[actorRole] ?? 0) > (h[targetRole] ?? 0);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return formatDate(iso);
}

function getInitial(user: ManagedUser): string {
  if (user.display_name) return user.display_name.charAt(0).toUpperCase();
  if (user.email) return user.email.charAt(0).toUpperCase();
  return '?';
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function SettingsUsersTab({
  currentUserId,
  currentUserRole,
  isOwner,
  workspaceId,
}: SettingsUsersTabProps) {
  // User data
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Invitations
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(true);

  // In-flight operations
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Deactivation confirmation
  const [confirmDeactivate, setConfirmDeactivate] = useState<ManagedUser | null>(null);

  // Revoke confirmation
  const [confirmRevoke, setConfirmRevoke] = useState<PendingInvitation | null>(null);

  // Delete confirmation (owner-only permanent delete)
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null);

  /* ---- Fetchers ---- */

  const fetchUsers = useCallback(async () => {
    try {
      const data = await fetchJson<ManagedUser[]>(apiUrl(`/api/users?workspace_id=${workspaceId}`));
      setUsers(data);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, [workspaceId]);

  const fetchInvitations = useCallback(async () => {
    try {
      const data = await fetchJson<{ invitations: PendingInvitation[] }>(
        apiUrl('/api/invitations'),
      );
      setInvitations(data.invitations);
    } catch {
      // Non-critical — invitations may simply not exist
      setInvitations([]);
    } finally {
      setInvitationsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchInvitations();
  }, [fetchUsers, fetchInvitations]);

  /* ---- Role change ---- */

  const handleRoleChange = async (user: ManagedUser, newRole: UserRole) => {
    if (newRole === user.role) return;
    setRoleChangingId(user.id);
    try {
      await fetchJson(apiUrl(`/api/users/${user.id}/role`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      toast.success(`${user.display_name || user.email}'s role changed to ${ROLE_LABELS[newRole]}`);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setRoleChangingId(null);
    }
  };

  /* ---- Status toggle ---- */

  const handleStatusToggle = async (user: ManagedUser) => {
    const newActive = !user.is_active;
    setStatusChangingId(user.id);
    try {
      await fetchJson(apiUrl(`/api/users/${user.id}/status`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newActive }),
      });
      toast.success(
        newActive
          ? `${user.display_name || user.email} has been reactivated`
          : `${user.display_name || user.email} has been deactivated`,
      );
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_active: newActive } : u)));
      setConfirmDeactivate(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setStatusChangingId(null);
    }
  };

  /* ---- Invitation actions ---- */

  const handleResendInvite = async (inv: PendingInvitation) => {
    setResendingId(inv.id);
    try {
      await fetchJson(apiUrl(`/api/invitations/${inv.id}`), { method: 'PUT' });
      toast.success(`Invitation resent to ${inv.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend invitation');
    } finally {
      setResendingId(null);
    }
  };

  const handleRevokeInvite = async (inv: PendingInvitation) => {
    // Optimistic removal
    setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    setConfirmRevoke(null);
    setRevokingId(null);

    toastWithUndo(`Invitation for ${inv.email} revoked`, {
      action: async () => {
        await fetchJson(apiUrl(`/api/invitations/${inv.id}`), { method: 'DELETE' });
      },
      onUndo: () => {
        setInvitations((prev) => [...prev, inv]);
      },
      undoMessage: `Invitation for ${inv.email} restored`,
      errorMessage: 'Failed to revoke invitation',
    });
  };

  /* ---- Permanent delete (owner only) ---- */

  const handleDeleteUser = async (user: ManagedUser) => {
    const label = user.display_name || user.email;
    setDeletingId(user.id);
    try {
      await fetchJson(apiUrl(`/api/users/${user.id}`), { method: 'DELETE' });
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      toast.success(`${label} permanently deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setConfirmDelete(null);
      setDeletingId(null);
    }
  };

  /* ---- Filtered users ---- */

  const filteredUsers = searchQuery.trim()
    ? users.filter((u) => {
        const q = searchQuery.toLowerCase();
        return u.email?.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q);
      })
    : users;

  /* ---- Helpers for permission checks ---- */

  const canManage = (target: ManagedUser) =>
    target.id !== currentUserId && canActorManageTarget(currentUserRole, target.role);

  const canToggleStatus = (target: ManagedUser) =>
    target.id !== currentUserId &&
    target.role !== 'owner' &&
    canActorManageTarget(currentUserRole, target.role);

  const roles = assignableRoles(currentUserRole);

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
          <Users className="h-5 w-5" />
          Users
        </h2>
        <p className="text-muted-foreground text-sm">Manage team members and their roles.</p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or email..."
          aria-label="Search users by name or email"
          className="border-border bg-surface-100 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border py-2 pr-3 pl-9 text-sm outline-none"
        />
      </div>

      {/* Users table */}
      {usersLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="py-12 text-center">
          <Users className="text-muted-foreground mx-auto h-8 w-8" />
          <p className="text-muted-foreground mt-3 text-sm">
            {searchQuery.trim() ? 'No users match your search.' : 'No users found.'}
          </p>
        </div>
      ) : (
        <div className="bg-surface-75 border-border rounded-lg border">
          {/* Table header — hidden on mobile, visible on md+ */}
          <div
            className="border-border hidden grid-cols-[1fr_100px_80px_110px_110px_110px_100px] gap-4 border-b px-4 py-2.5 md:grid"
            role="row"
          >
            <span
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              User
            </span>
            <span
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              Role
            </span>
            <span
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              Status
            </span>
            <span
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              Joined
            </span>
            <span
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              Last Login
            </span>
            <span
              className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              Last Active
            </span>
            <span
              className="text-muted-foreground text-right text-xs font-medium tracking-wider uppercase"
              role="columnheader"
            >
              Actions
            </span>
          </div>

          {/* User rows */}
          {filteredUsers.map((user) => {
            const isSelf = user.id === currentUserId;
            const manageable = canManage(user);
            const statusToggleable = canToggleStatus(user);
            const roleStyle = ROLE_COLORS[user.role] ?? ROLE_COLORS.member;

            return (
              <div
                key={user.id}
                className={`border-border flex flex-col gap-3 border-b px-4 py-3 last:border-b-0 md:grid md:grid-cols-[1fr_100px_80px_110px_110px_110px_100px] md:items-center md:gap-4 ${
                  !user.is_active ? 'opacity-60' : ''
                }`}
              >
                {/* Avatar + Name + Email */}
                <div className="flex min-w-0 items-center gap-3">
                  {user.avatar_url ? (
                    <Image
                      src={user.avatar_url}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                      width={32}
                      height={32}
                      unoptimized
                    />
                  ) : (
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-brand) 20%, transparent)',
                        color: 'var(--color-brand)',
                      }}
                    >
                      {getInitial(user)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-medium">
                      {user.display_name || user.email || 'Unknown'}
                      {isSelf && (
                        <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                          (you)
                        </span>
                      )}
                    </p>
                    {user.display_name && user.email && (
                      <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                    )}
                  </div>
                </div>

                {/* Role */}
                <div>
                  {manageable && !isSelf && roles.length > 0 ? (
                    <div className="relative inline-block">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user, e.target.value as UserRole)}
                        disabled={roleChangingId === user.id}
                        aria-label={`Role for ${user.display_name || user.email || 'user'}`}
                        className="border-border bg-surface-100 text-foreground cursor-pointer appearance-none rounded-md border py-1 pr-7 pl-2.5 text-xs font-medium outline-none"
                        style={{ minWidth: '80px' }}
                      >
                        {!roles.includes(user.role) && (
                          <option value={user.role}>{ROLE_LABELS[user.role]}</option>
                        )}
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-1.5 h-3 w-3 -translate-y-1/2" />
                      {roleChangingId === user.id && (
                        <Loader2 className="text-muted-foreground absolute top-1/2 right-6 h-3 w-3 -translate-y-1/2 animate-spin" />
                      )}
                    </div>
                  ) : (
                    <span className="border-border bg-surface-100 text-foreground inline-block cursor-default rounded-md border px-2.5 py-1 text-xs font-medium">
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  )}
                </div>

                {/* Status */}
                <div>
                  {user.is_active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      Inactive
                    </span>
                  )}
                </div>

                {/* Joined — hidden on mobile */}
                <span className="text-muted-foreground hidden text-xs md:block">
                  {formatDate(user.created_at)}
                </span>

                {/* Last Login — hidden on mobile */}
                <span className="text-muted-foreground hidden text-xs md:block">
                  {formatRelative(user.last_sign_in_at)}
                </span>

                {/* Last Active — hidden on mobile */}
                <span className="text-muted-foreground hidden text-xs md:block">
                  {formatRelative(user.last_active_at)}
                </span>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1">
                  {statusToggleable && (
                    <button
                      type="button"
                      title={user.is_active ? 'Deactivate user' : 'Reactivate user'}
                      disabled={statusChangingId === user.id}
                      onClick={() => {
                        if (user.is_active) {
                          setConfirmDeactivate(user);
                        } else {
                          handleStatusToggle(user);
                        }
                      }}
                      className="hover:bg-surface-100 rounded-md p-1.5 transition-colors"
                    >
                      {statusChangingId === user.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : user.is_active ? (
                        <ShieldOff className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <Shield className="h-3.5 w-3.5 text-green-400" />
                      )}
                    </button>
                  )}
                  {isOwner && !isSelf && user.role !== 'owner' && (
                    <button
                      type="button"
                      title="Permanently delete user"
                      disabled={deletingId === user.id}
                      onClick={() => setConfirmDelete(user)}
                      className="hover:bg-surface-100 rounded-md p-1.5 transition-colors"
                    >
                      {deletingId === user.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </button>
                  )}
                  {!statusToggleable && !isOwner && !isSelf && (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                  {isSelf && <span className="text-muted-foreground text-xs">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending Invitations Section */}
      {(isOwner || currentUserRole === 'admin') && (
        <div className="space-y-3">
          <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Mail className="h-4 w-4" />
            Pending Invitations
            {!invitationsLoading && invitations.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {invitations.length}
              </Badge>
            )}
          </h3>

          {invitationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : invitations.length === 0 ? (
            <div className="bg-surface-75 border-border rounded-lg border px-4 py-8 text-center">
              <Mail className="text-muted-foreground mx-auto h-6 w-6" />
              <p className="text-muted-foreground mt-2 text-sm">No pending invitations.</p>
            </div>
          ) : (
            <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
              {invitations.map((inv) => {
                const invRoleStyle = ROLE_COLORS[inv.role] ?? ROLE_COLORS.member;
                return (
                  <div key={inv.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          backgroundColor:
                            'color-mix(in srgb, var(--color-border-strong) 20%, transparent)',
                          color: 'var(--color-foreground-muted)',
                        }}
                      >
                        {inv.email?.charAt(0).toUpperCase() ?? '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-foreground truncate text-sm">{inv.email}</p>
                        <p className="text-muted-foreground flex items-center gap-1 text-xs">
                          <Clock className="h-3 w-3" />
                          Invited {formatDate(inv.invited_at)}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="brand"
                      style={{
                        backgroundColor: invRoleStyle.bg,
                        borderColor: invRoleStyle.border,
                        color: invRoleStyle.text,
                      }}
                    >
                      {ROLE_LABELS[inv.role] ?? inv.role}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Resend invitation"
                        disabled={resendingId === inv.id}
                        onClick={() => handleResendInvite(inv)}
                        className="hover:bg-surface-100 rounded-md p-1.5 transition-colors"
                      >
                        {resendingId === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCw className="text-muted-foreground h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="Revoke invitation"
                        disabled={revokingId === inv.id}
                        onClick={() => setConfirmRevoke(inv)}
                        className="hover:bg-surface-100 rounded-md p-1.5 transition-colors"
                      >
                        {revokingId === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-400" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Deactivation Confirmation Dialog */}
      {confirmDeactivate && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setConfirmDeactivate(null)}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="deactivate-dialog-title"
              className="border-border bg-surface-75 w-full max-w-sm rounded-lg border p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="deactivate-dialog-title"
                className="text-foreground mb-2 text-lg font-semibold"
              >
                Deactivate User
              </h3>
              <p className="text-muted-foreground mb-5 text-sm">
                Are you sure you want to deactivate{' '}
                <strong className="text-foreground">
                  {confirmDeactivate.display_name || confirmDeactivate.email}
                </strong>
                ? They will lose access until reactivated.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="md" onClick={() => setConfirmDeactivate(null)}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  variant="destructive"
                  onClick={() => handleStatusToggle(confirmDeactivate)}
                  disabled={statusChangingId === confirmDeactivate.id}
                >
                  {statusChangingId === confirmDeactivate.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldOff className="mr-1 h-4 w-4" />
                  )}
                  Deactivate
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Revoke Invitation Confirmation Dialog */}
      {confirmRevoke && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setConfirmRevoke(null)}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="revoke-dialog-title"
              className="border-border bg-surface-75 w-full max-w-sm rounded-lg border p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="revoke-dialog-title" className="text-foreground mb-2 text-lg font-semibold">
                Revoke Invitation
              </h3>
              <p className="text-muted-foreground mb-5 text-sm">
                Are you sure you want to revoke the invitation for{' '}
                <strong className="text-foreground">{confirmRevoke.email}</strong>? This cannot be
                undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="md" onClick={() => setConfirmRevoke(null)}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  variant="destructive"
                  onClick={() => handleRevokeInvite(confirmRevoke)}
                  disabled={revokingId === confirmRevoke.id}
                >
                  {revokingId === confirmRevoke.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-1 h-4 w-4" />
                  )}
                  Revoke
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Permanent Delete Confirmation Dialog (Owner Only) */}
      {confirmDelete && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setConfirmDelete(null)}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
              className="border-border bg-surface-75 w-full max-w-sm rounded-lg border p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="delete-dialog-title" className="text-foreground mb-2 text-lg font-semibold">
                Permanently Delete User
              </h3>
              <p className="text-muted-foreground mb-2 text-sm">
                This will permanently remove{' '}
                <strong className="text-foreground">
                  {confirmDelete.display_name || confirmDelete.email}
                </strong>{' '}
                from the system.
              </p>
              <p className="mb-5 text-sm text-red-400">
                This action cannot be undone. Their email will be able to sign up again as a new
                user.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="md" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  variant="destructive"
                  onClick={() => handleDeleteUser(confirmDelete)}
                  disabled={deletingId === confirmDelete.id}
                >
                  {deletingId === confirmDelete.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-4 w-4" />
                  )}
                  Delete Permanently
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
