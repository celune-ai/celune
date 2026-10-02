'use client';

import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { AGENTS, AGENT_COLORS } from '@/lib/agents-data';
import { TASK_ASSIGNEE_LABELS } from '@repo/types';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { formatRelativeTime } from '@/lib/date-utils';

interface LiveStatus {
  status: string;
  last_heartbeat: string | null;
  current_task_id: string | null;
  model: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string }> = {
  working: { label: 'Working', dot: 'bg-brand', bg: 'border-brand/30' },
  online: { label: 'Standby', dot: 'bg-warning', bg: 'border-warning/30' },
  idle: { label: 'Idle', dot: 'bg-surface-400', bg: 'border-border' },
  offline: { label: 'Offline', dot: 'bg-destructive', bg: 'border-destructive/30' },
};

export function AgentStatusGrid() {
  const [liveStatus, setLiveStatus] = useState<Record<string, LiveStatus>>({});

  useEffect(() => {
    const fetchStatus = () => {
      fetchJson<Record<string, LiveStatus>>(apiUrl('/api/agents/status'))
        .then((data) => {
          if (data && typeof data === 'object' && !('error' in data)) setLiveStatus(data);
        })
        .catch(() => {
          /* Non-blocking — status refreshes on next poll */
        });
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const labels = TASK_ASSIGNEE_LABELS as Record<string, string>;
  const aiAgents = AGENTS.filter((a) => a.type === 'ai');

  return (
    <div className="border-border bg-surface-75 rounded-lg border p-4">
      <h3 className="text-foreground mb-3 text-sm font-medium">Agent Status</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {aiAgents.map((agent) => {
          const live = liveStatus[agent.name.toLowerCase()] ?? liveStatus[agent.id];
          const status = live?.status ?? 'offline';
          const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.offline;
          const agentColor = AGENT_COLORS[agent.id];
          const isWorking = status === 'working';

          return (
            <div
              key={agent.id}
              className={`flex items-start gap-2.5 rounded-lg border p-3 transition-all ${config.bg} ${
                isWorking ? 'shadow-sm' : ''
              }`}
              style={
                isWorking && agentColor
                  ? {
                      borderColor: `${agentColor.hex}40`,
                      boxShadow: `inset 2px 0 0 ${agentColor.hex}`,
                    }
                  : {}
              }
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: agentColor ? `${agentColor.hex}20` : 'var(--color-surface-200)',
                }}
              >
                <Bot
                  className="h-4 w-4"
                  style={{ color: agentColor?.hex ?? 'var(--color-foreground-lighter)' }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${config.dot} ${
                      isWorking ? 'animate-pulse' : ''
                    }`}
                  />
                  <span className="text-foreground truncate text-xs font-medium">
                    {labels[agent.id] ?? agent.name}
                  </span>
                </div>
                <p className="text-foreground-lighter mt-0.5 text-[10px]">
                  {config.label}
                  {live?.last_heartbeat && <> &middot; {formatRelativeTime(live.last_heartbeat)}</>}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
