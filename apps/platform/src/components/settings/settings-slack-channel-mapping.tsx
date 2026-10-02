'use client';

/**
 * Slack Channel Mapping UI
 *
 * Allows users to configure which Slack channel receives each event category.
 * Used in the notifications settings tab once Slack is connected.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationPreference {
  id: string;
  channel: string;
  event_types: string[];
  slack_channel: string | null;
  frequency: string;
  is_enabled: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Event type groups — can be mapped to different Slack channels
const EVENT_GROUPS = [
  {
    group: 'Tasks',
    events: ['task.completed', 'task.assigned', 'task.blocked'],
    defaultChannel: '#general',
    description: 'Task completions, assignments, and blockers',
  },
  {
    group: 'Code Reviews',
    events: ['review.requested', 'review.completed'],
    defaultChannel: '#code-reviews',
    description: 'SCAN code review requests and results',
  },
  {
    group: 'Deployments',
    events: ['deploy.triggered', 'deploy.completed'],
    defaultChannel: '#deployments',
    description: 'Deploy events and build results',
  },
  {
    group: 'Agent Status',
    events: ['agent.status_changed'],
    defaultChannel: '#general',
    description: 'Agent online/offline transitions',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  workspaceId: string;
  slackPref: NotificationPreference | undefined;
  onSaved: () => void;
}

export function SlackChannelMapping({ workspaceId, slackPref, onSaved }: Props) {
  // Per-group channel overrides (channelName or empty = use workspace default)
  const [channelMap, setChannelMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Initialize from existing preference (stored as slack_channel is the default)
    // For now, the preference has one slack_channel that applies to all events.
    // This component prepopulates with that default.
    const defaultCh = slackPref?.slack_channel ?? '';
    const initial: Record<string, string> = {};
    for (const group of EVENT_GROUPS) {
      initial[group.group] = defaultCh;
    }
    setChannelMap(initial);
  }, [slackPref]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // For MVP, save a single slack_channel from the first group (most common)
      // Phase 2 will have per-event-group channel rows
      const primaryChannel = Object.values(channelMap).find(Boolean) ?? '';

      const res = await fetchJson<{ preference: NotificationPreference }>(
        apiUrl('/api/notifications/preferences'),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            channel: 'slack',
            event_types: slackPref?.event_types ?? ['task.completed', 'task.blocked'],
            slack_channel: primaryChannel || null,
            frequency: slackPref?.frequency ?? 'immediate',
            is_enabled: slackPref?.is_enabled ?? true,
          }),
        },
      );

      if ('error' in res) {
        toast.error('Failed to save channel mapping');
        return;
      }

      toast.success('Slack channel mapping saved');
      onSaved();
    } catch {
      toast.error('Failed to save channel mapping');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-foreground text-sm font-medium">Slack Channel Routing</p>
        <p className="text-foreground-lighter mt-0.5 text-xs">
          Choose which Slack channel receives each type of notification. Leave blank to use the
          workspace default channel from your Slack connection.
        </p>
      </div>

      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                Event Group
              </th>
              <th className="text-foreground-lighter px-4 py-2.5 text-left text-xs font-medium">
                Slack Channel
              </th>
            </tr>
          </thead>
          <tbody>
            {EVENT_GROUPS.map(({ group, description, defaultChannel }, i) => (
              <tr
                key={group}
                className={`border-border ${i < EVENT_GROUPS.length - 1 ? 'border-b' : ''}`}
              >
                <td className="px-4 py-3">
                  <p className="text-foreground text-xs font-medium">{group}</p>
                  <p className="text-foreground-lighter text-xs">{description}</p>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={channelMap[group] ?? ''}
                    onChange={(e) =>
                      setChannelMap((prev) => ({ ...prev, [group]: e.target.value }))
                    }
                    placeholder={defaultChannel}
                    className="border-border bg-surface-200 text-foreground placeholder-foreground-lighter w-full rounded border px-2 py-1 text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Save Channel Mapping
      </Button>
    </div>
  );
}
