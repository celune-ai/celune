'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
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
  Globe,
  ShieldCheck,
  Bell,
  Building2,
  Plug,
  ExternalLink,
  Database,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { URL_DOCS } from '@/lib/branding';
import { PageActionBar } from '@/components/page-action-bar';
import { PageTabs } from '@/components/page-tabs';
import type { PageTab } from '@/components/page-tabs';
import dynamic from 'next/dynamic';

const SettingsUsersTab = dynamic(() =>
  import('@/components/settings-users-tab').then((m) => ({ default: m.SettingsUsersTab })),
);
const SettingsApiKeysTab = dynamic(() =>
  import('@/components/settings-api-keys-tab').then((m) => ({ default: m.SettingsApiKeysTab })),
);
const SettingsWebhooksTab = dynamic(() =>
  import('@/components/settings-webhooks-tab').then((m) => ({ default: m.SettingsWebhooksTab })),
);
const SettingsNotificationsTab = dynamic(() =>
  import('@/components/settings/settings-notifications-tab').then((m) => ({
    default: m.SettingsNotificationsTab,
  })),
);
const SettingsRolesTab = dynamic(() =>
  import('@/components/settings/settings-roles-tab').then((m) => ({
    default: m.SettingsRolesTab,
  })),
);
const SettingsOrganizationTab = dynamic(() =>
  import('@/components/settings/settings-organization-tab').then((m) => ({
    default: m.SettingsOrganizationTab,
  })),
);
const SettingsIntegrationsTab = dynamic(() =>
  import('@/components/settings/settings-integrations-tab').then((m) => ({
    default: m.SettingsIntegrationsTab,
  })),
);
const IdeConnectionsCard = dynamic(() =>
  import('@/components/settings/ide-connections-card').then((m) => ({
    default: m.IdeConnectionsCard,
  })),
);
const UsageMeters = dynamic(() =>
  import('@/components/settings/usage-meters').then((m) => ({
    default: m.UsageMeters,
  })),
);
const SettingsBillingTab = dynamic(() =>
  import('@/components/settings/settings-billing-tab').then((m) => ({
    default: m.SettingsBillingTab,
  })),
);
const SettingsBrainDataTab = dynamic(() =>
  import('@/components/settings/settings-brain-data-tab').then((m) => ({
    default: m.SettingsBrainDataTab,
  })),
);
const SettingsWorkspaceMigration = dynamic(() =>
  import('@/components/settings/settings-workspace-migration').then((m) => ({
    default: m.SettingsWorkspaceMigration,
  })),
);
const IntegrationsComingSoon = dynamic(() =>
  import('@/components/settings/integrations-coming-soon').then((m) => ({
    default: m.IntegrationsComingSoon,
  })),
);
import { usePlan } from '@/hooks/use-plan';
import { usePermissions } from '@/hooks/use-permissions';
import { useFlag } from '@/hooks/use-flags';
import { FeatureGate } from '@/components/feature-gate';
import { PasswordStrength } from '@/components/password-strength';
import { isPasswordValid } from '@/lib/password-policy';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { createClient } from '@repo/db/client';
import { AvatarPicker } from '@/components/avatar-picker';
import { useWorkspace } from '@/providers/workspace-provider';
import type { PermissionKey } from '@repo/types';

type Tab =
  | 'general'
  | 'organization'
  | 'users'
  | 'roles'
  | 'sessions'
  | 'billing'
  | 'notifications'
  | 'integrations'
  | 'brain';

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
  const router = useRouter();
  const pathname = usePathname();
  const { activeWorkspace } = useWorkspace();
  const { isPlatformOwner, plan } = usePlan();
  const { can: canPerm } = usePermissions();
  const { enabled: integrationsEnabled } = useFlag('integrations-hub');
  const initialTab = (searchParams.get('tab') as Tab) || 'general';
  const [tab, setTab] = useState<Tab>(initialTab);

  const handleTabChange = useCallback(
    (newTab: string) => {
      const t = newTab as Tab;
      setTab(t);
      const params = new URLSearchParams(searchParams.toString());
      if (t === 'general') {
        params.delete('tab');
      } else {
        params.set('tab', t);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Profile form state
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Email change state
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);

  // Password change state
  const [editingPassword, setEditingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

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

  // 2FA / MFA state
  const [mfaFactors, setMfaFactors] = useState<{ id: string; type: string; status: string }[]>([]);
  const [mfaEnrolling, setMfaEnrolling] = useState(false);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [mfaUnenrolling, setMfaUnenrolling] = useState(false);

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

  // Fetch MFA factors when sessions tab loads
  const fetchMfaFactors = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setMfaFactors(
        (data.totp ?? []).map((f) => ({ id: f.id, type: f.factor_type, status: f.status })),
      );
    } catch {
      // Silent — MFA might not be enabled on this Supabase project
    }
  }, []);

  useEffect(() => {
    if (tab === 'sessions') fetchMfaFactors();
  }, [tab, fetchMfaFactors]);

  const handleMfaEnroll = async () => {
    setMfaEnrolling(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (error) throw error;
      setMfaQrCode(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaFactorId(data.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start 2FA enrollment');
    } finally {
      setMfaEnrolling(false);
    }
  };

  const handleMfaVerify = async () => {
    if (!mfaFactorId || mfaVerifyCode.length !== 6) return;
    setMfaVerifying(true);
    try {
      const supabase = createClient();
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challenge.id,
        code: mfaVerifyCode,
      });
      if (verifyError) throw verifyError;

      toast.success('Two-factor authentication enabled');
      setMfaQrCode(null);
      setMfaSecret(null);
      setMfaFactorId(null);
      setMfaVerifyCode('');
      fetchMfaFactors();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid verification code');
    } finally {
      setMfaVerifying(false);
    }
  };

  const handleMfaUnenroll = async (factorId: string) => {
    setMfaUnenrolling(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success('Two-factor authentication disabled');
      fetchMfaFactors();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable 2FA');
    } finally {
      setMfaUnenrolling(false);
    }
  };

  const handleMfaCancelEnroll = () => {
    // If we enrolled but didn't verify, unenroll the pending factor
    if (mfaFactorId) {
      const supabase = createClient();
      supabase.auth.mfa.unenroll({ factorId: mfaFactorId }).catch(() => {
        /* Best-effort cleanup — pending factor can be re-enrolled */
      });
    }
    setMfaQrCode(null);
    setMfaSecret(null);
    setMfaFactorId(null);
    setMfaVerifyCode('');
  };

  const mfaEnabled = mfaFactors.some((f) => f.status === 'verified');

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteSending, setInviteSending] = useState(false);

  const canManageTeam = isPlatformOwner || plan !== 'unpaid';
  const allTabs: (PageTab & {
    ownerOnly?: boolean;
    teamOnly?: boolean;
    requirePerm?: PermissionKey;
  })[] = [
    { id: 'general', label: 'Profile', icon: User },
    {
      id: 'organization',
      label: 'Organization',
      icon: Building2,
    },
    { id: 'integrations', label: 'Integrations', icon: Plug, ownerOnly: true },
    { id: 'users', label: 'Users', icon: Users, teamOnly: true },
    {
      id: 'roles',
      label: 'Roles',
      icon: ShieldCheck,
      teamOnly: true,
      requirePerm: 'settings:manage',
    },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'sessions', label: 'Sessions', icon: MonitorSmartphone },
    { id: 'brain', label: 'Data & Migration', icon: Database },
    { id: 'billing', label: 'Billing', icon: CreditCard },
  ];

  const visibleTabs: PageTab[] = allTabs.filter(
    (t) =>
      (!t.ownerOnly || isOwner) &&
      (!t.teamOnly || canManageTeam) &&
      (!t.requirePerm || canPerm(t.requirePerm)),
  );

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
      {!userLoading && <PageTabs tabs={visibleTabs} active={tab} onChange={handleTabChange} />}

      {/* Tab content */}
      <div className="mx-auto w-full max-w-4xl space-y-8 p-6">
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
                        className="border-border bg-surface-75 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 text-sm outline-none"
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
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ring-1 ring-inset ${
                          profile?.role === 'owner'
                            ? 'bg-purple-500/15 text-purple-400 ring-purple-500/25'
                            : profile?.role === 'admin'
                              ? 'bg-blue-500/15 text-blue-400 ring-blue-500/25'
                              : profile?.role === 'member'
                                ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25'
                                : 'bg-gray-500/15 text-gray-400 ring-gray-500/25'
                        }`}
                      >
                        {profile?.role ?? 'Unknown'}
                      </span>
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

            {/* Email & Password — side by side */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Email Change Section */}
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
                      <Mail className="h-5 w-5" />
                      Email
                    </h2>
                    <p className="text-muted-foreground text-sm">
                      Update the email address associated with your account.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingEmail(!editingEmail);
                      if (editingEmail) {
                        setNewEmail('');
                        setEmailConfirmationSent(false);
                      }
                    }}
                  >
                    {editingEmail ? 'Cancel' : 'Edit'}
                  </Button>
                </div>
                <div className="bg-surface-75 border-border rounded-lg border p-6">
                  <div className="space-y-3">
                    <div>
                      <label className="text-muted-foreground mb-1 block text-xs font-medium">
                        {editingEmail ? 'Current Email' : 'Email'}
                      </label>
                      <input
                        value={userEmail ?? ''}
                        readOnly
                        className="border-border bg-surface-75 text-muted-foreground w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm outline-none"
                      />
                    </div>
                    {editingEmail && (
                      <>
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
                            className="border-border bg-surface-75 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 text-sm outline-none"
                          />
                        </div>
                        {emailConfirmationSent && (
                          <p className="text-xs" style={{ color: '#34B27B' }}>
                            A confirmation link has been sent to your new email address. Please
                            check your inbox and click the link to complete the change.
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
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Password Section */}
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-foreground mb-1 flex items-center gap-2 text-lg font-medium">
                      <Lock className="h-5 w-5" />
                      Password
                    </h2>
                    <p className="text-muted-foreground text-sm">Update your account password.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingPassword(!editingPassword);
                      if (editingPassword) {
                        setNewPassword('');
                        setConfirmPassword('');
                        setShowNewPassword(false);
                        setShowConfirmPassword(false);
                      }
                    }}
                  >
                    {editingPassword ? 'Cancel' : 'Edit'}
                  </Button>
                </div>
                <div className="bg-surface-75 border-border rounded-lg border p-6">
                  <div className="space-y-3">
                    <div>
                      <label className="text-muted-foreground mb-1 block text-xs font-medium">
                        Password
                      </label>
                      <input
                        value="••••••••••••"
                        readOnly
                        className="border-border bg-surface-75 text-muted-foreground w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm outline-none"
                      />
                    </div>
                    {editingPassword && (
                      <>
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
                              className="border-border bg-surface-75 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 pr-9 text-sm outline-none"
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
                              className="border-border bg-surface-75 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border px-3 py-2 pr-9 text-sm outline-none"
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
                          <PasswordStrength
                            password={newPassword}
                            confirmPassword={confirmPassword}
                          />
                        </div>
                        <div className="flex justify-end pt-1">
                          <Button
                            size="md"
                            onClick={handlePasswordChange}
                            disabled={passwordSaving || !newPassword || !confirmPassword}
                          >
                            {passwordSaving ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : null}
                            Update Password
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* IDE Connections — personal per-user setup */}
            <IdeConnectionsCard />
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
              <div className="space-y-8">
                {/* Session Control Card */}
                <div className="space-y-3">
                  <h3 className="text-foreground text-sm font-bold">Session Control</h3>
                  <div className="bg-surface-75 border-border divide-border divide-y rounded-lg border">
                    <div className="p-4">
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
                              <span className="text-foreground text-sm font-medium">
                                This device
                              </span>
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
                  </div>
                </div>

                {/* Two-Factor Authentication */}
                <div className="space-y-3">
                  <h3 className="text-foreground text-sm font-bold">Two-Factor Authentication</h3>
                  <div className="bg-surface-75 border-border rounded-lg border p-4">
                    {mfaQrCode ? (
                      /* Enrollment flow — QR code + verification */
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                            style={{ backgroundColor: '#3B82F61a' }}
                          >
                            <ShieldCheck className="h-4 w-4" style={{ color: '#3B82F6' }} />
                          </div>
                          <div>
                            <p className="text-foreground text-sm font-medium">
                              Scan this QR code with your authenticator app
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              Use an app like Google Authenticator, Authy, or 1Password.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-center gap-3 py-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={mfaQrCode}
                            alt="2FA QR Code"
                            className="h-48 w-48 rounded-lg bg-white p-2"
                          />
                          {mfaSecret && (
                            <div className="text-center">
                              <p className="text-muted-foreground text-xs">
                                Or enter this key manually:
                              </p>
                              <code className="text-foreground mt-1 inline-block rounded bg-black/30 px-3 py-1 font-mono text-xs tracking-widest select-all">
                                {mfaSecret}
                              </code>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <label htmlFor="mfa-code" className="text-foreground text-sm font-medium">
                            Verification code
                          </label>
                          <div className="flex gap-2">
                            <input
                              id="mfa-code"
                              type="text"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              placeholder="000000"
                              value={mfaVerifyCode}
                              onChange={(e) =>
                                setMfaVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                              }
                              className="border-border bg-surface-200 text-foreground placeholder:text-muted-foreground w-32 rounded-md border px-3 py-2 font-mono text-sm tracking-widest focus:border-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none"
                            />
                            <Button
                              size="md"
                              onClick={handleMfaVerify}
                              disabled={mfaVerifying || mfaVerifyCode.length !== 6}
                            >
                              {mfaVerifying ? (
                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldCheck className="mr-1 h-4 w-4" />
                              )}
                              Verify &amp; Enable
                            </Button>
                            <Button size="md" variant="ghost" onClick={handleMfaCancelEnroll}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : mfaEnabled ? (
                      /* 2FA is enabled — show status + unenroll option */
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                            style={{ backgroundColor: '#34B27B1a' }}
                          >
                            <ShieldCheck className="h-4 w-4" style={{ color: '#34B27B' }} />
                          </div>
                          <div>
                            <p className="text-foreground text-sm font-medium">
                              Two-factor authentication is enabled
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              Your account is protected with TOTP-based two-factor authentication.
                            </p>
                          </div>
                        </div>
                        <Button
                          size="md"
                          variant="destructive"
                          onClick={() => {
                            const verified = mfaFactors.find((f) => f.status === 'verified');
                            if (verified) handleMfaUnenroll(verified.id);
                          }}
                          disabled={mfaUnenrolling}
                          className="shrink-0"
                        >
                          {mfaUnenrolling ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : null}
                          Disable 2FA
                        </Button>
                      </div>
                    ) : (
                      /* 2FA not enabled — show enable option */
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                            style={{ backgroundColor: '#71717A1a' }}
                          >
                            <ShieldCheck className="h-4 w-4" style={{ color: '#71717A' }} />
                          </div>
                          <div>
                            <p className="text-foreground text-sm font-medium">
                              Two-factor authentication is not enabled
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                              Add an extra layer of security to your account by requiring a code
                              from your authenticator app when signing in.
                            </p>
                          </div>
                        </div>
                        <Button
                          size="md"
                          onClick={handleMfaEnroll}
                          disabled={mfaEnrolling}
                          className="shrink-0"
                        >
                          {mfaEnrolling ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="mr-1 h-4 w-4" />
                          )}
                          Enable 2FA
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Login History */}
                <div className="space-y-3">
                  <h3 className="text-foreground text-sm font-bold">Sign-in History</h3>
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

        {/* Roles Tab */}
        {tab === 'roles' && <SettingsRolesTab />}

        {/* Brain Data Tab */}
        {tab === 'brain' && activeWorkspace && (
          <div className="space-y-10">
            <SettingsWorkspaceMigration workspaceId={activeWorkspace.id} />
            <SettingsBrainDataTab workspaceId={activeWorkspace.id} />
          </div>
        )}

        {/* Billing Tab */}
        {tab === 'billing' && activeWorkspace && (
          <SettingsBillingTab workspaceId={activeWorkspace.id} />
        )}

        {/* Organization Tab */}
        {tab === 'organization' && <SettingsOrganizationTab isOwner={isOwner} />}

        {/* Notifications Tab */}
        {tab === 'notifications' && <SettingsNotificationsTab />}

        {/* Integrations Tab */}
        {tab === 'integrations' &&
          (integrationsEnabled ? (
            <div className="space-y-10">
              <FeatureGate feature="integrations">
                <SettingsIntegrationsTab onNavigateTab={handleTabChange} />
              </FeatureGate>
              <hr className="border-border" />
              <SettingsApiKeysTab />
              <hr className="border-border" />
              <SettingsWebhooksTab />
              {plan !== 'unpaid' && (
                <>
                  <hr className="border-border" />
                  {/* Custom Integration — paid plans */}
                  <section className="space-y-4">
                    <h3 className="text-foreground text-sm font-medium tracking-wide uppercase opacity-60">
                      Custom Integration
                    </h3>
                    <div className="bg-surface-75 border-border rounded-lg border p-4">
                      <div className="flex items-start gap-3">
                        <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                          <ExternalLink className="text-foreground h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <p className="text-foreground text-sm font-medium">Custom via SDK</p>
                          <p className="text-foreground-lighter mt-0.5 text-xs">
                            Build your own integration using the Celune webhook API. Custom
                            integrations work but have no in-app visibility — you manage your own
                            webhook delivery.
                          </p>
                        </div>
                        <a
                          href={`${URL_DOCS}/notifications/custom-sdk`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button size="sm" variant="outline" className="shrink-0 gap-1.5">
                            <ExternalLink className="h-3 w-3" />
                            View Docs
                          </Button>
                        </a>
                      </div>
                      <div className="border-border bg-surface-200 mt-4 rounded border p-3">
                        <p className="text-foreground-lighter text-xs">
                          <span className="text-foreground font-medium">
                            Built-in (Celune SDK):
                          </span>{' '}
                          Full in-app visibility — settings, controls, notification history, test
                          sends.
                        </p>
                        <p className="text-foreground-lighter mt-1 text-xs">
                          <span className="text-foreground font-medium">Custom:</span> You manage
                          your own webhooks. Celune has no visibility into delivery status or
                          history.
                        </p>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>
          ) : (
            <IntegrationsComingSoon />
          ))}
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
                      className="border-border bg-surface-75 text-foreground placeholder:text-muted-foreground focus:border-brand w-full rounded-md border py-2 pr-3 pl-9 text-sm outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-muted-foreground mb-2 block text-xs font-medium">
                    Role
                  </label>
                  <div className="space-y-2">
                    {(
                      [
                        {
                          value: 'admin' as const,
                          label: 'Admin',
                          desc: 'Full access to settings, users, and billing',
                          icon: ShieldCheck,
                        },
                        {
                          value: 'member' as const,
                          label: 'Member',
                          desc: 'Create and manage tasks, projects, and agents',
                          icon: Users,
                        },
                        {
                          value: 'viewer' as const,
                          label: 'Viewer',
                          desc: 'Read-only access to workspace content',
                          icon: Eye,
                        },
                      ] as const
                    ).map((role) => {
                      const selected = inviteRole === role.value;
                      return (
                        <button
                          key={role.value}
                          type="button"
                          onClick={() => setInviteRole(role.value)}
                          className={`border-border flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                            selected ? 'border-brand bg-brand/5' : 'hover:bg-surface-100'
                          }`}
                        >
                          <role.icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-brand' : 'text-muted-foreground'}`}
                          />
                          <div>
                            <p
                              className={`text-sm font-medium ${selected ? 'text-brand' : 'text-foreground'}`}
                            >
                              {role.label}
                            </p>
                            <p className="text-muted-foreground text-xs">{role.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
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
