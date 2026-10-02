'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Loader2,
  Eye,
  EyeOff,
  Users,
  Lock,
  Mail,
  UserPlus,
  User,
  MonitorSmartphone,
  LogOut,
  Clock,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { PageActionBar } from '@/components/page-action-bar';
import { PageTabs } from '@/components/page-tabs';
import type { PageTab } from '@/components/page-tabs';
import { SettingsUsersTab } from '@/components/settings-users-tab';
import { PasswordStrength } from '@/components/password-strength';
import { isPasswordValid } from '@/lib/password-policy';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { createClient } from '@repo/db/client';
import { AvatarPicker } from '@/components/avatar-picker';
import { useWorkspace } from '@/providers/workspace-provider';
import { SettingsBillingTab } from '@/components/settings/settings-billing-tab';

type Tab = 'general' | 'users' | 'sessions' | 'billing';

interface UserProfile {
  id: string;
  email: string | undefined;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface CurrentSession {
  accessToken: string | null;
  expiresAt: number | undefined;
  userId: string;
  email: string | undefined;
  lastSignIn: string | undefined;
}

interface LoginHistoryEntry {
  id: string;
  event_type: string;
  source: string | null;
  title: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface SessionsData {
  currentSession: CurrentSession | null;
  loginHistory: LoginHistoryEntry[];
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'general';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const { activeWorkspace } = useWorkspace();

  // Profile form state
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Email change state
  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Derive owner status from DB role (profile.role comes from user_roles table via /api/user/profile).
  // Derive owner status from DB role (profile.role comes from user_roles table via /api/user/profile).
  const isOwner = profile?.role === 'owner';

  // Fetch current user + profile
  useEffect(() => {
    fetchJson<UserProfile>(apiUrl('/api/user/profile'))
      .then((data) => {
        setProfile(data);
        setUserEmail(data.email ?? null);
        setDisplayName(data.display_name ?? '');
        setAvatarUrl(data.avatar_url ?? '');
      })
      .catch(() => {
        // Fallback: get email from supabase client directly
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
          setUserEmail(data.user?.email ?? null);
        });
      })
      .finally(() => setUserLoading(false));
  }, []);

  const handleProfileSave = async () => {
    setProfileSaving(true);
    try {
      const updated = await fetchJson<{ display_name: string | null; avatar_url: string | null }>(
        apiUrl('/api/user/profile'),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: displayName.trim() || null,
            avatar_url: avatarUrl.trim() || null,
          }),
        },
      );
      setProfile((prev) => (prev ? { ...prev, ...updated } : prev));
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleEmailChange = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) {
      toast.error('Please enter a new email address');
      return;
    }
    if (trimmed === userEmail) {
      toast.error('New email is the same as your current email');
      return;
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Please enter a valid email address');
      return;
    }
    setEmailSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) throw error;
      setEmailConfirmationSent(true);
      toast.success('Confirmation email sent — check your inbox to verify the new address');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setEmailSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!isPasswordValid(newPassword)) {
      toast.error('Password does not meet the requirements');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setPasswordSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setPasswordSaving(false);
    }
  };

  // Sessions state
  const [sessionsData, setSessionsData] = useState<SessionsData | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsSigningOut, setSessionsSigningOut] = useState(false);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await fetchJson<SessionsData>(apiUrl('/api/user/sessions'));
      setSessionsData(data);
    } catch {
      toast.error('Failed to load session data');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'sessions') fetchSessions();
  }, [tab, fetchSessions]);

  const handleSignOutOthers = async () => {
    setSessionsSigningOut(true);
    try {
      await fetchJson(apiUrl('/api/user/sessions?scope=others'), { method: 'DELETE' });
      toast.success('Signed out of all other sessions');
      fetchSessions();
    } catch {
      toast.error('Failed to sign out other sessions');
    } finally {
      setSessionsSigningOut(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    setSessionsSigningOut(true);
    try {
      await fetchJson(apiUrl('/api/user/sessions?scope=global'), { method: 'DELETE' });
      toast.success('Signed out everywhere — redirecting...');
      setTimeout(() => {
        window.location.href = '/login';
      }, 1200);
    } catch {
      toast.error('Failed to sign out everywhere');
      setSessionsSigningOut(false);
    }
  };

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteSending, setInviteSending] = useState(false);

  const allTabs: (PageTab & { ownerOnly?: boolean })[] = [
    { id: 'general', label: 'Profile', icon: User },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'sessions', label: 'Sessions', icon: MonitorSmartphone },
    { id: 'billing', label: 'Billing', icon: CreditCard },
  ];

  const visibleTabs: PageTab[] = allTabs.filter((t) => !t.ownerOnly || isOwner);

  const roleColor: Record<string, { bg: string; border: string; text: string }> = {
    owner: { bg: '#34B27B', border: '#34B27B', text: '#161616' },
    admin: { bg: '#3B82F6', border: '#3B82F6', text: '#161616' },
    member: { bg: '#22C55E', border: '#22C55E', text: '#161616' },
    viewer: { bg: '#71717A', border: '#71717A', text: '#161616' },
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    try {
      const res = await fetch(apiUrl('/api/user/invite'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send invitation');
        return;
      }
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('member');
    } catch {
      toast.error('Failed to send invitation');
    } finally {
      setInviteSending(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Settings</span>
        {tab === 'users' && (
          <Button size="md" onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1 h-4 w-4" />
            Add User
          </Button>
        )}
      </PageActionBar>

      {/* Tabs */}
      {!userLoading && (
        <PageTabs tabs={visibleTabs} active={tab} onChange={(id) => setTab(id as Tab)} />
      )}

      {/* Tab content */}
      <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
        {/* General Tab */}
        {tab === 'general' && (
          <div className="space-y-8">
            {/* Profile Section */}
            <div className="space-y-4">
              <div>
                <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
                  <User className="h-5 w-5" />
                  Profile
                </h2>
                <p className="text-muted-foreground text-sm">
                  Your public display name and avatar.
                </p>
              </div>
              <div className="bg-surface-75 border-border rounded-lg border p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                  {/* Avatar */}
                  <AvatarPicker
                    avatarUrl={avatarUrl || null}
                    fallbackText={displayName || userEmail || '?'}
                    onAvatarChange={(url) => {
                      setAvatarUrl(url);
                      setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev));
                    }}
                    excludeAgentAvatars
                  />

                  {/* Fields */}
                  <div className="flex-1 space-y-4">
                    <div>
                      <label className="text-muted-foreground mb-1 block text-xs font-medium">
                        Display Name
                      </label>
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your name"
                        className="border-border bg-surface-100 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground mb-1 block text-xs font-medium">
                        Email
                      </label>
                      <input
                        value={userEmail ?? ''}
                        readOnly
                        className="border-border bg-surface-75 text-muted-foreground w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-muted-foreground mb-1 block text-xs font-medium">
                        Role
                      </label>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="brand"
                          style={
                            roleColor[profile?.role ?? 'member']
                              ? {
                                  backgroundColor: roleColor[profile?.role ?? 'member'].bg,
                                  borderColor: roleColor[profile?.role ?? 'member'].border,
                                  color: roleColor[profile?.role ?? 'member'].text,
                                }
                              : {}
                          }
                        >
                          {profile?.role ?? 'member'}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          Role is managed by an administrator.
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button size="md" onClick={handleProfileSave} disabled={profileSaving}>
                        {profileSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                        Save Profile
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Email Change Section */}
            <div className="space-y-4">
              <div>
                <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
                  <Mail className="h-5 w-5" />
                  Change Email
                </h2>
                <p className="text-muted-foreground text-sm">
                  Update the email address associated with your account.
                </p>
              </div>
              <div className="bg-surface-75 border-border rounded-lg border p-6">
                <div className="max-w-sm space-y-3">
                  <div>
                    <label className="text-muted-foreground mb-1 block text-xs font-medium">
                      Current Email
                    </label>
                    <input
                      value={userEmail ?? ''}
                      readOnly
                      className="border-border bg-surface-75 text-muted-foreground w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-muted-foreground mb-1 block text-xs font-medium">
                      New Email
                    </label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => {
                        setNewEmail(e.target.value);
                        setEmailConfirmationSent(false);
                      }}
                      placeholder="Enter new email address"
                      className="border-border bg-surface-100 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 text-sm outline-none"
                    />
                  </div>
                  {emailConfirmationSent && (
                    <p className="text-xs" style={{ color: '#34B27B' }}>
                      A confirmation link has been sent to your new email address. Please check your
                      inbox and click the link to complete the change.
                    </p>
                  )}
                  <div className="flex justify-end pt-1">
                    <Button
                      size="md"
                      onClick={handleEmailChange}
                      disabled={emailSaving || !newEmail.trim()}
                    >
                      {emailSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Change Email
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Password Section */}
            <div className="space-y-4">
              <div>
                <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
                  <Lock className="h-5 w-5" />
                  Change Password
                </h2>
                <p className="text-muted-foreground text-sm">Update your account password.</p>
              </div>
              <div className="bg-surface-75 border-border rounded-lg border p-6">
                <div className="max-w-sm space-y-3">
                  <div>
                    <label className="text-muted-foreground mb-1 block text-xs font-medium">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min. 10 characters"
                        className="border-border bg-surface-100 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 pr-9 text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <PasswordStrength password={newPassword} />
                  </div>
                  <div>
                    <label className="text-muted-foreground mb-1 block text-xs font-medium">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat new password"
                        className="border-border bg-surface-100 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 pr-9 text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      size="md"
                      onClick={handlePasswordChange}
                      disabled={passwordSaving || !newPassword || !confirmPassword}
                    >
                      {passwordSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      Update Password
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {tab === 'sessions' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
                <MonitorSmartphone className="h-5 w-5" />
                Sessions
              </h2>
              <p className="text-muted-foreground text-sm">
                Manage your active sessions and view sign-in history.
              </p>
            </div>

            {sessionsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Current Session Card */}
                <div className="space-y-3">
                  <h3 className="text-foreground text-sm font-medium">Current Session</h3>
                  <div className="bg-surface-75 border-border rounded-lg border p-4">
                    {sessionsData?.currentSession ? (
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ backgroundColor: '#34B27B1a' }}
                        >
                          <MonitorSmartphone className="h-4 w-4" style={{ color: '#34B27B' }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground text-sm font-medium">This device</span>
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{ backgroundColor: '#34B27B1a', color: '#34B27B' }}
                            >
                              Active
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {sessionsData.currentSession.email}
                          </p>
                          {sessionsData.currentSession.lastSignIn && (
                            <p className="text-muted-foreground mt-1 text-xs">
                              Last sign-in:{' '}
                              {new Date(sessionsData.currentSession.lastSignIn).toLocaleString()}
                            </p>
                          )}
                          {sessionsData.currentSession.expiresAt && (
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              Session expires:{' '}
                              {new Date(
                                sessionsData.currentSession.expiresAt * 1000,
                              ).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">No active session found.</p>
                    )}
                  </div>
                </div>

                {/* Sign-out Actions */}
                <div className="space-y-3">
                  <h3 className="text-foreground text-sm font-medium">Session Control</h3>
                  <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
                    <div className="flex items-start justify-between gap-4 p-4">
                      <div>
                        <p className="text-foreground text-sm font-medium">
                          Sign out other sessions
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          Revokes access on all other devices while keeping this session active.
                        </p>
                      </div>
                      <Button
                        size="md"
                        variant="ghost"
                        onClick={handleSignOutOthers}
                        disabled={sessionsSigningOut}
                        className="shrink-0"
                      >
                        {sessionsSigningOut ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <LogOut className="mr-1 h-4 w-4" />
                        )}
                        Sign out others
                      </Button>
                    </div>
                    <div className="flex items-start justify-between gap-4 p-4">
                      <div>
                        <p className="text-foreground text-sm font-medium">Sign out everywhere</p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          Revokes access on all devices including this one. You will be redirected
                          to sign in.
                        </p>
                      </div>
                      <Button
                        size="md"
                        variant="destructive"
                        onClick={handleSignOutEverywhere}
                        disabled={sessionsSigningOut}
                        className="shrink-0"
                      >
                        {sessionsSigningOut ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <LogOut className="mr-1 h-4 w-4" />
                        )}
                        Sign out everywhere
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Login History */}
                <div className="space-y-3">
                  <h3 className="text-foreground text-sm font-medium">Sign-in History</h3>
                  {!sessionsData?.loginHistory || sessionsData.loginHistory.length === 0 ? (
                    <div className="border-border rounded-lg border border-dashed p-8 text-center">
                      <Clock className="text-muted-foreground mx-auto h-8 w-8" />
                      <p className="text-muted-foreground mt-3 text-sm">No sign-in history yet.</p>
                    </div>
                  ) : (
                    <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
                      {sessionsData.loginHistory.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                          <Clock className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-foreground text-sm">{entry.title}</p>
                            {(() => {
                              if (!entry.details || typeof entry.details !== 'object') return null;
                              const ip = entry.details.ip as string | undefined;
                              const ua = entry.details.user_agent as string | undefined;
                              if (!ip && !ua) return null;
                              return (
                                <p className="text-muted-foreground mt-0.5 text-xs">
                                  {[ip, ua].filter(Boolean).join(' · ')}
                                </p>
                              );
                            })()}
                          </div>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {new Date(entry.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Users Tab */}
        {tab === 'users' && (
          <SettingsUsersTab
            currentUserId={profile?.id ?? null}
            currentUserRole={(profile?.role as 'owner' | 'admin' | 'member' | 'viewer') ?? 'member'}
            isOwner={isOwner}
            workspaceId={activeWorkspace?.id ?? ''}
          />
        )}

        {/* Billing Tab */}
        {tab === 'billing' && <SettingsBillingTab workspaceId={activeWorkspace?.id ?? ''} />}
      </div>

      {/* Invite User Dialog */}
      {inviteOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setInviteOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="invite-user-dialog-title"
              className="border-border bg-surface-75 w-full max-w-md rounded-lg border p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3
                id="invite-user-dialog-title"
                className="text-foreground mb-4 text-lg font-semibold"
              >
                Invite User
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs font-medium">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="border-border bg-surface-100 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border py-2 pr-3 pl-9 text-sm outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-muted-foreground mb-1 block text-xs font-medium">
                    Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
                    className="border-border bg-surface-100 text-foreground focus:border-brand w-full rounded-md border px-3 py-2 text-sm outline-none"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" size="md" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  onClick={handleInvite}
                  disabled={inviteSending || !inviteEmail.trim()}
                >
                  {inviteSending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-1 h-4 w-4" />
                  )}
                  Send Invite
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPageInner />
    </Suspense>
  );
}
