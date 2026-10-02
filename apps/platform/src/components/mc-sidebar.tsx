'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mcNav } from '@/lib/nav';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { SlackLogo } from '@/components/icons/integration-logos';
import { BranchIndicator } from '@/components/branch-indicator';
import { IdeConnectionIndicator } from '@/components/ide-connection-indicator';

interface SlackNavStatus {
  connected: boolean;
  team_id: string | null;
  team_name: string | null;
}

export function McSidebar() {
  const pathname = usePathname();
  const { activeWorkspace } = useWorkspace();
  const [slackStatus, setSlackStatus] = useState<SlackNavStatus | null>(null);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;
    fetchJson<{ connection: SlackNavStatus | null }>(
      apiUrl(`/api/notifications/slack/status?workspace_id=${activeWorkspace.id}`),
    ).then((res) => {
      if (cancelled || 'error' in res) return;
      setSlackStatus(res.connection ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  return (
    <nav aria-label="Celune" className="flex h-full flex-col py-6 pr-4">
      <h4
        className="mb-4 px-3 text-[14px] font-semibold tracking-wider uppercase"
        style={{ color: 'hsl(0deg 0.2% 62.09%)', marginBottom: '4px' }}
      >
        Celune
      </h4>

      {/* GitHub repo + branch */}
      <div className="mb-1">
        <BranchIndicator />
      </div>

      {/* IDE connection status */}
      <div className="mb-3">
        <IdeConnectionIndicator />
      </div>

      <ul className="space-y-0.5">
        {mcNav.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-surface-300 text-foreground font-medium'
                    : 'text-foreground-lighter hover:bg-surface-200 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Slack link — shown when connected */}
      {slackStatus?.connected && slackStatus.team_id && (
        <div className="border-border mt-auto border-t pt-3">
          <a
            href={`https://app.slack.com/client/${slackStatus.team_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
          >
            <span className="relative">
              <SlackLogo className="h-4 w-4 shrink-0" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500" />
            </span>
            {slackStatus.team_name ?? 'Slack'}
          </a>
        </div>
      )}
    </nav>
  );
}
