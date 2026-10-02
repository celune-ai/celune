'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, UserPlus, XCircle, Copy, Clock, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Badge } from '@repo/ui/components/badge';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';

interface WorkspaceInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
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

function formatRelativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Expired';
    if (diffDays === 1) return 'Expires tomorrow';
    return `Expires in ${diffDays} days`;
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

interface SettingsInvitationsSectionProps {
  planAllowsInvites: boolean;
  planLabel: string;
}

export function SettingsInvitationsSection({
  planAllowsInvites,
  planLabel,
}: SettingsInvitationsSectionProps) {
  const { activeWorkspace } = useWorkspace();
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [sending, setSending] = useState(false);

  // Revoke state
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const data = await fetchJson<{ invitations: WorkspaceInvitation[] }>(
        apiUrl(`/api/workspaces/${activeWorkspace.id}/invitations`),
      );
      setInvitations(data.invitations);
    } catch {
      // Non-critical
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const handleSendInvite = async () => {
    if (!activeWorkspace || !email.trim()) return;
    setSending(true);
    try {
      const data = await fetchJson<{ invitation: WorkspaceInvitation; accept_url: string }>(
        apiUrl(`/api/workspaces/${activeWorkspace.id}/invitations`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), role }),
        },
      );
      setInvitations((prev) => [data.invitation, ...prev]);
      setAcceptUrls((prev) => ({ ...prev, [data.invitation.id]: data.accept_url }));
      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail('');
      setRole('member');

      // Copy accept URL to clipboard
      try {
        await navigator.clipboard.writeText(data.accept_url);
        toast.success('Accept link copied to clipboard', { duration: 3000 });
      } catch {
        // Clipboard may not be available
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (inv: WorkspaceInvitation) => {
    if (!activeWorkspace) return;
    setRevokingId(inv.id);
    try {
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}/invitations/${inv.id}`), {
        method: 'DELETE',
      });
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
      toast.success(`Invitation for ${inv.email} revoked`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke invitation');
    } finally {
      setRevokingId(null);
    }
  };

  // Store accept URLs keyed by invitation ID (populated on creation)
  const [acceptUrls, setAcceptUrls] = useState<Record<string, string>>({});

  const handleCopyLink = async (inv: WorkspaceInvitation) => {
    const url = acceptUrls[inv.id];
    if (!url) {
      toast.error('Accept link not available — it was only shown when the invitation was created');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Accept link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  if (!activeWorkspace) return null;

  // Plan gate: an org without a plan subscribes before adding members
  if (!planAllowsInvites) {
    return (
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="p-6">
          <h3 className="mb-1 text-base font-semibold">Team Invitations</h3>
          <p className="text-foreground-muted mb-5 text-sm">
            Invite team members to collaborate in this workspace.
          </p>
          <div className="bg-surface-75 border-border rounded-lg border px-6 py-8 text-center">
            <UserPlus size={32} className="text-foreground-muted mx-auto mb-3" />
            <p className="text-foreground mb-1 text-sm font-medium">Subscribe to invite members</p>
            <p className="text-foreground-muted mb-4 text-xs">
              Your organization ({planLabel}) needs a Celune Cloud subscription to add members. Each
              active member is one seat.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const params = new URLSearchParams(window.location.search);
                params.set('tab', 'billing');
                window.history.replaceState(null, '', `?${params.toString()}`);
                window.location.reload();
              }}
            >
              <ArrowUpRight size={14} className="mr-1.5" />
              View billing
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="p-6">
        <h3 className="mb-1 text-base font-semibold">Team Invitations</h3>
        <p className="text-foreground-muted mb-5 text-sm">
          Invite team members to collaborate in this workspace.
        </p>

        {/* Invite form */}
        <div className="mb-5 flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-foreground-muted text-xs font-medium">Email address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendInvite();
              }}
            />
          </div>
          <div className="w-28 space-y-1.5">
            <label className="text-foreground-muted text-xs font-medium">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'member' | 'viewer')}
              className="border-border bg-surface-100 text-foreground focus:ring-brand/40 focus:border-brand h-9 w-full cursor-pointer appearance-none rounded-md border px-2.5 text-sm outline-none focus:ring-2"
            >
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <Button size="sm" onClick={handleSendInvite} disabled={sending || !email.trim()}>
            {sending ? (
              <>
                <Loader2 size={14} className="mr-1.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail size={14} className="mr-1.5" />
                Send Invite
              </>
            )}
          </Button>
        </div>

        {/* Pending invitations list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-foreground-muted h-5 w-5 animate-spin" />
          </div>
        ) : invitations.length === 0 ? (
          <div className="bg-surface-75 border-border rounded-lg border px-4 py-8 text-center">
            <Mail className="text-foreground-muted mx-auto h-6 w-6" />
            <p className="text-foreground-muted mt-2 text-sm">No pending invitations.</p>
          </div>
        ) : (
          <div>
            <p className="text-foreground-muted mb-2 text-xs font-medium tracking-wider uppercase">
              Pending ({invitations.length})
            </p>
            <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
              {invitations.map((inv) => {
                const roleStyle = ROLE_COLORS[inv.role] ?? ROLE_COLORS.member;
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
                        <p className="text-foreground-muted flex items-center gap-1 text-xs">
                          <Clock size={12} />
                          {formatRelativeDate(inv.expires_at)}
                          <span className="text-foreground-muted/50 mx-0.5">|</span>
                          Sent {formatDate(inv.created_at)}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="brand"
                      style={{
                        backgroundColor: roleStyle.bg,
                        borderColor: roleStyle.border,
                        color: roleStyle.text,
                      }}
                    >
                      {ROLE_LABELS[inv.role] ?? inv.role}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Copy invite link"
                        onClick={() => handleCopyLink(inv)}
                        className="hover:bg-surface-100 rounded-md p-1.5 transition-colors"
                      >
                        <Copy className="text-foreground-muted h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Revoke invitation"
                        disabled={revokingId === inv.id}
                        onClick={() => handleRevoke(inv)}
                        className="hover:bg-surface-100 rounded-md p-1.5 transition-colors"
                      >
                        {revokingId === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="text-destructive h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
