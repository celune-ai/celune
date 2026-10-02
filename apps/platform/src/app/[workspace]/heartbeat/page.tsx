'use client';

import { useState, useEffect } from 'react';
import { Activity, Clock, Mail, Zap, Stethoscope, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Label } from '@repo/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/select';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { PageActionBar } from '@/components/page-action-bar';
import { SettingsCard, SettingsToggle } from '@/components/settings/settings-shared';
import type { Workspace } from '@repo/types';

const COMING_FEATURES = [
  {
    icon: Zap,
    title: 'Scheduled Skills',
    description:
      'Run skills automatically on a schedule. Daily standups, weekly reports, recurring research.',
  },
  {
    icon: Stethoscope,
    title: 'Health Checks',
    description:
      'Periodic system status reports. Monitor agent uptime, API health, and workspace activity.',
  },
  {
    icon: Mail,
    title: 'Daily Digests',
    description:
      'Get a morning briefing with completed tasks, new insights, and what needs your attention.',
  },
  {
    icon: FileText,
    title: 'Meeting Notes',
    description: 'Automated meeting summaries and action items pushed to your task board.',
  },
  {
    icon: Clock,
    title: 'Email Digest Frequency',
    description:
      'Choose how often you receive updates: immediate, daily digest, weekly digest, or off.',
  },
  {
    icon: Clock,
    title: 'Automation Builder',
    description: 'Build custom heartbeat automations tied to your integrations. No code required.',
  },
];

export default function HeartbeatPage() {
  const { activeWorkspace } = useWorkspace();

  // Heartbeat configuration (stored in workspace metadata.heartbeat_config)
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [staleMultiplier, setStaleMultiplier] = useState(3);

  useEffect(() => {
    if (!activeWorkspace) return;
    const meta = (activeWorkspace as Workspace & { metadata?: Record<string, unknown> | null })
      .metadata;
    const hbConfig = (meta as Record<string, unknown>)?.heartbeat_config as
      Record<string, unknown> | undefined;
    if (hbConfig) {
      if (typeof hbConfig.enabled === 'boolean') setHeartbeatEnabled(hbConfig.enabled);
      if (typeof hbConfig.ping_interval_seconds === 'number')
        setHeartbeatInterval(hbConfig.ping_interval_seconds);
      if (typeof hbConfig.stale_threshold_multiplier === 'number')
        setStaleMultiplier(hbConfig.stale_threshold_multiplier);
    }
  }, [activeWorkspace]);

  async function saveHeartbeatConfig(updates: Record<string, unknown>) {
    if (!activeWorkspace) return;
    try {
      const existingMeta =
        (activeWorkspace as Workspace & { metadata?: Record<string, unknown> | null }).metadata ??
        {};
      const existingHb =
        ((existingMeta as Record<string, unknown>).heartbeat_config as Record<string, unknown>) ??
        {};
      await fetchJson(apiUrl(`/api/workspaces/${activeWorkspace.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            ...(existingMeta as Record<string, unknown>),
            heartbeat_config: { ...existingHb, ...updates },
          },
        }),
      });
      toast.success('Heartbeat settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save heartbeat settings');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageActionBar>
        <span className="text-foreground text-xl font-medium">Heartbeat</span>
      </PageActionBar>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* Heartbeat Configuration Card */}
          <SettingsCard
            footer={
              <div className="flex w-full items-center justify-between">
                <p className="text-foreground-muted text-sm">
                  Controls how frequently agents report their status.
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    saveHeartbeatConfig({
                      enabled: heartbeatEnabled,
                      ping_interval_seconds: heartbeatInterval,
                      stale_threshold_multiplier: staleMultiplier,
                    })
                  }
                >
                  Save
                </Button>
              </div>
            }
          >
            <h3 className="mb-1 text-base font-semibold">Heartbeat Configuration</h3>
            <p className="text-foreground-muted mb-5 text-sm">
              Configure agent health monitoring and stale detection for this workspace.
            </p>

            <div className="space-y-4">
              <SettingsToggle
                label="Enable heartbeat monitoring"
                description="Track agent activity and detect stale sessions automatically."
                checked={heartbeatEnabled}
                onCheckedChange={(v) => setHeartbeatEnabled(v)}
              />

              <div className="space-y-2">
                <Label>Ping interval</Label>
                <Select
                  value={String(heartbeatInterval)}
                  onValueChange={(v) => setHeartbeatInterval(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">Every 10 seconds</SelectItem>
                    <SelectItem value="30">Every 30 seconds</SelectItem>
                    <SelectItem value="60">Every 60 seconds</SelectItem>
                    <SelectItem value="120">Every 2 minutes</SelectItem>
                    <SelectItem value="300">Every 5 minutes</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-foreground-muted text-xs">
                  How often agents report their status.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Stale threshold</Label>
                <Select
                  value={String(staleMultiplier)}
                  onValueChange={(v) => setStaleMultiplier(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2x interval ({heartbeatInterval * 2}s)</SelectItem>
                    <SelectItem value="3">3x interval ({heartbeatInterval * 3}s)</SelectItem>
                    <SelectItem value="5">5x interval ({heartbeatInterval * 5}s)</SelectItem>
                    <SelectItem value="10">10x interval ({heartbeatInterval * 10}s)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-foreground-muted text-xs">
                  Agent is marked stale after missing this many consecutive heartbeats.
                </p>
              </div>
            </div>
          </SettingsCard>

          {/* Coming Soon features */}
          <div className="text-center">
            <div className="bg-surface-200 mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full">
              <Activity className="text-foreground-muted h-7 w-7" />
            </div>
            <h2 className="text-foreground text-lg font-semibold">More Coming Soon</h2>
            <p className="text-foreground-lighter mt-2 text-sm leading-relaxed">
              Heartbeat will be your always-on automation layer. Schedule skills, monitor health,
              receive daily digests, and build custom workflows that run while you sleep.
            </p>

            <div className="mt-8 grid gap-3 text-left">
              {COMING_FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="border-border bg-surface-75 flex items-start gap-3 rounded-lg border p-4"
                >
                  <div className="bg-surface-200 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
                    <feature.icon className="text-foreground-muted h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-foreground text-sm font-medium">{feature.title}</h3>
                    <p className="text-foreground-lighter mt-0.5 text-xs leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
