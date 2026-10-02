'use client';

import { useEffect, useState } from 'react';
import { Monitor, MonitorOff } from 'lucide-react';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';

/**
 * Compact IDE connection status indicator.
 * Shows a green dot when an IDE is actively connected to the workspace.
 * Polls every 30s to stay in sync.
 */
export function IdeConnectionIndicator() {
  const { activeWorkspace } = useWorkspace();
  const [connected, setConnected] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspace?.id) return;

    let interval: NodeJS.Timeout | null = null;

    async function check() {
      try {
        const res = await fetch(apiUrl(`/api/ide/status?workspace_id=${activeWorkspace!.id}`));
        if (res.ok) {
          const data = await res.json();
          setConnected(data.connected);
          setLastSeen(data.last_seen);
        }
      } catch {
        // Non-blocking
      }
    }

    function startPolling() {
      check();
      interval = setInterval(check, 30_000);
    }

    function stopPolling() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }

    // Start polling immediately if tab is visible
    if (!document.hidden) {
      startPolling();
    }

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeWorkspace?.id]);

  const label = connected
    ? `IDE connected${lastSeen ? ` · last active ${formatRelative(lastSeen)}` : ''}`
    : 'No IDE connected';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 px-2 py-1" role="status" aria-label={label}>
            {connected ? (
              <>
                <span className="bg-brand relative flex h-2 w-2 rounded-full">
                  <span className="bg-brand absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                  <span className="bg-brand relative inline-flex h-2 w-2 rounded-full" />
                </span>
                <Monitor className="text-foreground-lighter h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span className="bg-surface-300 h-2 w-2 rounded-full" />
                <MonitorOff className="text-foreground-lighter h-3.5 w-3.5 opacity-50" />
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
