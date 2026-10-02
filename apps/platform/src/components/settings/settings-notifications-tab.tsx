'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpCircle, Bell, CheckCircle2, Loader2, Mail, MessageSquare, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { Switch } from '@repo/ui/components/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { URL_DOCS } from '@/lib/branding';
import { SlackLogo } from '@/components/icons/integration-logos';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationPreference {
  id: string;
  channel: 'slack' | 'email' | 'discord' | 'teams' | 'telegram';
  event_types: string[];
  slack_channel: string | null;
  email_address: string | null;
  frequency: 'immediate' | 'digest_daily' | 'digest_weekly' | 'off';
  is_enabled: boolean;
}

interface SlackConnectionStatus {
  connected: boolean;
  team_name: string | null;
  channel: string | null;
  installation_type?: 'webhook' | 'bot';
  has_bot_scopes?: boolean;
  bot_display_name?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  { key: 'task.completed', label: 'Task Completed', description: 'When an agent finishes a task' },
  {
    key: 'review.requested',
    label: 'Review Requested',
    description: 'Code review requested on a PR',
  },
  { key: 'agent.status_changed', label: 'Agent Status', description: 'Agent goes online/offline' },
  {
    key: 'review.completed',
    label: 'Review Complete',
    description: 'Code review finished (pass or fail)',
  },
];

const FREQUENCY_OPTIONS = [
  { value: 'immediate', label: 'Immediate' },
  { value: 'digest_daily', label: 'Daily Digest' },
  { value: 'digest_weekly', label: 'Weekly Digest' },
  { value: 'off', label: 'Off' },
] as const;

// Coming-soon channels: shown as disabled cards
const COMING_SOON_CHANNELS = [
  { key: 'discord', label: 'Discord', description: 'Notifications in your Discord server' },
  { key: 'teams', label: 'Microsoft Teams', description: 'Notifications in Teams channels' },
  { key: 'telegram', label: 'Telegram', description: 'Notifications via Telegram bot' },
  { key: 'sms', label: 'SMS / Telecom', description: 'Text message alerts' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsNotificationsTab() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [slackStatus, setSlackStatus] = useState<SlackConnectionStatus>({
    connected: false,
    team_name: null,
    channel: null,
  });
  const [disconnecting, setDisconnecting] = useState(false);
  const [botDisplayName, setBotDisplayName] = useState('');
  const [savingBotName, setSavingBotName] = useState(false);

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [prefsRes, slackRes] = await Promise.allSettled([
        fetchJson<{ preferences: NotificationPreference[] }>(
          apiUrl(`/api/notifications/preferences?workspace_id=${workspaceId}`),
        ),
        fetchJson<{ connection: SlackConnectionStatus | null }>(
          apiUrl(`/api/notifications/slack/status?workspace_id=${workspaceId}`),
        ),
      ]);

      if (prefsRes.status === 'fulfilled' && !('error' in prefsRes.value)) {
        setPreferences(prefsRes.value.preferences ?? []);
      }
      if (slackRes.status === 'fulfilled' && !('error' in slackRes.value)) {
        const conn = slackRes.value.connection ?? {
          connected: false,
          team_name: null,
          channel: null,
        };
        setSlackStatus(conn);
        setBotDisplayName(conn.bot_display_name ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function getPref(channel: string): NotificationPreference | undefined {
    return preferences.find((p) => p.channel === channel);
  }

  async function upsertPref(
    channel: string,
    patch: Partial<Omit<NotificationPreference, 'id' | 'channel'>>,
  ) {
    if (!workspaceId) return;
    const existing = getPref(channel);
    const optimistic: NotificationPreference = {
      id: existing?.id ?? '',
      channel: channel as NotificationPreference['channel'],
      event_types: existing?.event_types ?? [],
      slack_channel: existing?.slack_channel ?? null,
      email_address: existing?.email_address ?? null,
      frequency: existing?.frequency ?? 'immediate',
      is_enabled: existing?.is_enabled ?? true,
      ...patch,
    };

    // Optimistic update — reflect the change immediately
    setPreferences((prev) => {
      const filtered = prev.filter((p) => p.channel !== channel);
      return [...filtered, optimistic];
    });

    const body = {
      workspace_id: workspaceId,
      channel,
      event_types: optimistic.event_types,
      frequency: optimistic.frequency,
      is_enabled: optimistic.is_enabled,
    };

    try {
      const res = await fetchJson<{ preference: NotificationPreference }>(
        apiUrl('/api/notifications/preferences'),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if ('error' in res) {
        // Revert on failure
        if (existing) {
          setPreferences((prev) => {
            const filtered = prev.filter((p) => p.channel !== channel);
            return [...filtered, existing];
          });
        }
        toast.error(`Failed to save ${channel} preference`);
        return;
      }
      // Sync with server response
      setPreferences((prev) => {
        const filtered = prev.filter((p) => p.channel !== channel);
        return [...filtered, res.preference];
      });
    } catch {
      // Revert on failure
      if (existing) {
        setPreferences((prev) => {
          const filtered = prev.filter((p) => p.channel !== channel);
          return [...filtered, existing];
        });
      }
      toast.error(`Failed to save ${channel} preference`);
    }
  }

  async function handleDisconnectSlack() {
    if (!workspaceId) return;
    setDisconnecting(true);
    try {
      const res = await fetchJson<{ success: boolean } | { error: string }>(
        apiUrl(`/api/notifications/slack/connect?workspace_id=${workspaceId}`),
        { method: 'DELETE' },
      );
      if ('error' in res) {
        toast.error('Failed to disconnect Slack');
        return;
      }
      setSlackStatus({ connected: false, team_name: null, channel: null });
      toast.success('Slack disconnected');
    } catch {
      toast.error('Failed to disconnect Slack');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleTestNotification(channel: string, eventType?: string) {
    if (!workspaceId) return;
    try {
      const payload: Record<string, string> = { workspaceId, channel };
      if (eventType) payload.eventType = eventType;
      const res = await fetchJson<{ sent: boolean } | { error: string }>(
        apiUrl('/api/notifications/test'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if ('error' in res) {
        toast.error(res.error ?? `Failed to send test notification`);
        return;
      }
      const label = eventType
        ? (EVENT_TYPES.find((e) => e.key === eventType)?.label ?? eventType)
        : 'notification';
      toast.success(`Test ${label} sent via ${channel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const jsonMatch = msg.match(/\{.*"error"\s*:\s*"([^"]+)"/);
      toast.error(jsonMatch?.[1] ?? `Failed to send test ${channel} notification`);
    }
  }

  async function handleSaveBotName() {
    if (!workspaceId) return;
    setSavingBotName(true);
    try {
      const res = await fetchJson<{ success: boolean } | { error: string }>(
        apiUrl('/api/notifications/slack/status'),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            bot_display_name: botDisplayName.trim() || null,
          }),
        },
      );
      if ('error' in res) {
        toast.error(res.error ?? 'Failed to save bot name');
        return;
      }
      setSlackStatus((prev) => ({
        ...prev,
        bot_display_name: botDisplayName.trim() || null,
      }));
      toast.success('Bot display name updated');
    } catch {
      toast.error('Failed to save bot name');
    } finally {
      setSavingBotName(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-foreground-lighter h-6 w-6 animate-spin" />
      </div>
    );
  }

  const emailPref = getPref('email');
  const slackPref = getPref('slack');

  return (
    <div className="space-y-8 py-2">
      {/* ── Header ── */}
      <div>
        <h2 className="text-foreground text-lg font-medium">Notifications</h2>
        <p className="text-foreground-lighter mt-1 text-sm">
          Choose how your agents reach you when something important happens.
        </p>
      </div>

      {/* ── Email ── */}
      <section className="space-y-4">
        <h3 className="text-foreground text-sm font-medium tracking-wide uppercase opacity-60">
          Email
        </h3>

        {/* Email Card */}
        <div className="border-border bg-surface-100 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="bg-surface-200 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                <Mail className="text-foreground h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-foreground text-sm font-medium">Email</p>
                  <Badge variant="muted" className="text-xs">
                    Always On
                  </Badge>
                </div>
                <p className="text-foreground-lighter mt-0.5 text-xs">
                  Receive email digests and alerts
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TestEventDropdown channel="email" onTest={handleTestNotification} />
            </div>
          </div>

          {/* Email frequency moved to Heartbeat page */}
        </div>
      </section>

      {/* ── Communications ── */}
      <section className="space-y-4">
        <h3 className="text-foreground text-sm font-medium tracking-wide uppercase opacity-60">
          Communications
        </h3>

        {/* Slack Card */}
        <div className="border-border bg-surface-100 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-surface-200 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                <SlackLogo className="h-4 w-4" />
              </div>
              <div className="flex items-center" style={{ gap: '12px' }}>
                <p className="text-foreground text-sm font-medium">Slack</p>
                {slackStatus.connected && (
                  <Badge className="bg-green-500/10 text-xs text-green-500">Connected</Badge>
                )}
              </div>
              {!slackStatus.connected && (
                <p className="text-foreground-lighter text-xs">
                  Get notified in your team&apos;s Slack workspace
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {slackStatus.connected ? (
                <>
                  <Switch
                    checked={slackPref?.is_enabled ?? true}
                    onCheckedChange={(v) => upsertPref('slack', { is_enabled: v })}
                  />
                  <TestEventDropdown channel="slack" onTest={handleTestNotification} />
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    window.location.assign(
                      apiUrl(
                        `/api/notifications/slack/connect?workspace_id=${workspaceId}&from=settings`,
                      ),
                    )
                  }
                  className="gap-1.5"
                >
                  <Zap className="h-3 w-3" />
                  Connect Slack
                </Button>
              )}
            </div>
          </div>

          {/* Upgrade banner for webhook-only installs */}
          {slackStatus.connected && slackStatus.installation_type === 'webhook' && (
            <div className="border-brand/20 bg-brand/5 mt-4 rounded-md border p-3">
              <div className="flex items-start gap-2.5">
                <ArrowUpCircle className="text-brand mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="text-foreground text-xs font-medium">Upgrade to Celune Bot</p>
                  <p className="text-foreground-lighter mt-0.5 text-xs leading-relaxed">
                    Your Slack connection uses a legacy webhook. Upgrade to the Celune Bot for slash
                    commands, Home Tab agent panel, interactive buttons, and bidirectional
                    messaging.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 gap-1.5"
                    onClick={() =>
                      window.location.assign(
                        apiUrl(
                          `/api/notifications/slack/connect?workspace_id=${workspaceId}&from=settings&mode=bot`,
                        ),
                      )
                    }
                  >
                    <Zap className="h-3 w-3" />
                    Upgrade Connection
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Bot install badge */}
          {slackStatus.connected && slackStatus.installation_type === 'bot' && (
            <div className="mt-3 flex items-center gap-1.5 px-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span className="text-foreground-lighter text-xs">
                Celune Bot — slash commands, Home Tab, and interactive messages enabled
              </span>
            </div>
          )}

          {/* Bot display name customization (bot installs only) */}
          {slackStatus.connected && slackStatus.installation_type === 'bot' && (
            <div className="border-border mt-4 flex items-center gap-3 border-t pt-4">
              <label className="text-foreground-lighter shrink-0 text-xs font-bold">
                Bot Display Name
              </label>
              <input
                type="text"
                value={botDisplayName}
                onChange={(e) => setBotDisplayName(e.target.value)}
                placeholder="Customize how the bot appears in Slack messages"
                maxLength={80}
                className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter/50 flex-1 rounded border px-2.5 py-1.5 text-xs"
              />
            </div>
          )}

          {slackStatus.connected && (
            <div className="border-border mt-4 flex items-center justify-between border-t pt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnectSlack}
                disabled={disconnecting}
                className="text-destructive gap-1.5"
              >
                {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Disconnect
              </Button>
              {slackStatus.installation_type === 'bot' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveBotName}
                  disabled={
                    savingBotName ||
                    (botDisplayName.trim() || '') === (slackStatus.bot_display_name || '')
                  }
                >
                  {savingBotName ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Coming Soon communication channels */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {COMING_SOON_CHANNELS.map((ch) => (
            <div
              key={ch.key}
              className="border-border bg-surface-100 relative rounded-lg border p-4 opacity-50"
            >
              <div className="flex items-start gap-3">
                <div className="bg-surface-300 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                  <Bell className="text-foreground-lighter h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-foreground text-sm font-medium">{ch.label}</p>
                    <Badge variant="muted" className="text-xs">
                      Coming Soon
                    </Badge>
                  </div>
                  <p className="text-foreground-lighter mt-0.5 text-xs">{ch.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Event Subscriptions ── */}

      <section className="space-y-4">
        <h3 className="text-foreground text-sm font-medium tracking-wide uppercase opacity-60">
          Event Subscriptions
        </h3>
        <p className="text-foreground-lighter text-xs">
          Choose which events you receive via each active channel.
        </p>
        <div className="border-border overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                  Event
                </th>
                <th className="text-foreground-lighter px-4 py-2.5 text-center text-xs font-medium">
                  <div className="flex items-center justify-center gap-1">
                    <Mail className="h-3 w-3" />
                    Email
                  </div>
                </th>
                <th className="text-foreground-lighter px-4 py-2.5 text-center text-xs font-medium">
                  <div className="flex items-center justify-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    Slack
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {EVENT_TYPES.map(({ key, label, description }, i) => {
                const emailEnabled = emailPref?.event_types?.includes(key) ?? false;
                const slackEnabled = slackStatus.connected
                  ? (slackPref?.event_types?.includes(key) ?? true)
                  : false;
                return (
                  <tr
                    key={key}
                    className={`border-border ${i < EVENT_TYPES.length - 1 ? 'border-b' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <p className="text-foreground text-xs font-medium">{label}</p>
                      <p className="text-foreground-lighter text-xs">{description}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch
                        checked={emailEnabled}
                        onCheckedChange={(v) => {
                          const types = emailPref?.event_types ?? [];
                          const next = v ? [...types, key] : types.filter((t) => t !== key);
                          upsertPref('email', { event_types: [...new Set(next)] });
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch
                        checked={slackEnabled}
                        disabled={!slackStatus.connected}
                        onCheckedChange={(v) => {
                          const types = slackPref?.event_types ?? [];
                          const next = v ? [...types, key] : types.filter((t) => t !== key);
                          upsertPref('slack', { event_types: [...new Set(next)] });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test Event Dropdown
// ---------------------------------------------------------------------------

function TestEventDropdown({
  channel,
  onTest,
}: {
  channel: string;
  onTest: (channel: string, eventType?: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          Test
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onTest(channel)}>Send test notification</DropdownMenuItem>
        {EVENT_TYPES.map((evt) => (
          <DropdownMenuItem key={evt.key} onClick={() => onTest(channel, evt.key)}>
            {evt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
