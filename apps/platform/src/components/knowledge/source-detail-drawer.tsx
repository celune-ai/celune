'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Pause,
  Play,
  Unplug,
  CheckCircle2,
  XCircle,
  Clock,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@repo/ui/utils';
import { Button } from '@repo/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import type { KnowledgeSource, SourceStatus } from './source-table';
import { SourceIcon } from './source-table';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncHistoryEntry {
  id: string;
  status: 'success' | 'error' | 'partial';
  items_synced: number;
  duration_ms: number;
  started_at: string;
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

const STATUS_DISPLAY: Record<SourceStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'text-green-400' },
  syncing: { label: 'Syncing', color: 'text-brand' },
  error: { label: 'Error', color: 'text-amber-400' },
  paused: { label: 'Paused', color: 'text-foreground-muted' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Mock sync history (will be replaced with real API)
// ---------------------------------------------------------------------------

function generateMockHistory(source: KnowledgeSource): SyncHistoryEntry[] {
  const entries: SyncHistoryEntry[] = [];
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    entries.push({
      id: `${source.id}-sync-${i}`,
      status: i === 0 && source.status === 'error' ? 'error' : i === 3 ? 'partial' : 'success',
      items_synced: Math.floor(source.items_synced * (0.01 + Math.random() * 0.05)),
      duration_ms: 2000 + Math.floor(Math.random() * 30000),
      started_at: new Date(now - i * 3600000 * (2 + Math.random() * 4)).toISOString(),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SourceDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  source: KnowledgeSource | null;
  onResync?: (sourceId: string) => void;
  onTogglePause?: (sourceId: string, paused: boolean) => void;
  onDisconnect?: (sourceId: string) => void;
}

export function SourceDetailDrawer({
  open,
  onClose,
  source,
  onResync,
  onTogglePause,
  onDisconnect,
}: SourceDetailDrawerProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset disconnect confirmation when drawer closes or source changes
  useEffect(() => {
    setConfirmDisconnect(false);
  }, [open, source?.id]);

  if (!source) return null;

  const statusCfg = STATUS_DISPLAY[source.status];
  const history = generateMockHistory(source);
  const avgDuration =
    history.length > 0
      ? Math.round(history.reduce((sum, h) => sum + h.duration_ms, 0) / history.length)
      : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${source.name} knowledge source details`}
        className={cn(
          'border-border bg-surface-75 fixed top-0 right-0 z-[61] flex h-full w-full max-w-[480px] flex-col border-l shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="border-border flex items-start justify-between border-b px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
              <SourceIcon provider={source.provider} />
            </div>
            <div>
              <h2 className="text-foreground text-lg font-semibold">{source.name}</h2>
              <span className={cn('text-xs font-medium', statusCfg.color)}>{statusCfg.label}</span>
            </div>
          </div>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Health stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-surface-100 rounded-lg p-3">
              <div className="text-foreground-muted flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Items Indexed
              </div>
              <div className="text-foreground mt-1 text-lg font-semibold">
                {source.items_synced.toLocaleString()}
              </div>
            </div>
            <div className="bg-surface-100 rounded-lg p-3">
              <div className="text-foreground-muted flex items-center gap-1.5 text-xs">
                <HardDrive className="h-3.5 w-3.5" />
                Storage Used
              </div>
              <div className="text-foreground mt-1 text-lg font-semibold">
                {formatBytes(source.storage_bytes)}
              </div>
            </div>
            <div className="bg-surface-100 rounded-lg p-3">
              <div className="text-foreground-muted flex items-center gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" />
                Last Sync
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
                {source.last_sync ? formatDateTime(source.last_sync) : 'Never'}
              </div>
            </div>
            <div className="bg-surface-100 rounded-lg p-3">
              <div className="text-foreground-muted flex items-center gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" />
                Avg Duration
              </div>
              <div className="text-foreground mt-1 text-sm font-medium">
                {formatDuration(avgDuration)}
              </div>
            </div>
          </div>

          {/* Sync history */}
          <div className="mt-6">
            <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
              Sync History
            </h3>
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="border-border flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  {entry.status === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />
                  ) : entry.status === 'error' ? (
                    <XCircle className="h-4 w-4 shrink-0 text-red-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground text-sm">
                      {entry.items_synced.toLocaleString()} items
                    </div>
                    <div className="text-foreground-muted text-xs">
                      {formatDateTime(entry.started_at)}
                    </div>
                  </div>
                  <span className="text-foreground-muted shrink-0 text-xs">
                    {formatDuration(entry.duration_ms)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions footer */}
        <div className="border-border space-y-2 border-t px-5 py-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            disabled={source.status === 'syncing'}
            onClick={() => onResync?.(source.id)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Re-sync Now
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={() => onTogglePause?.(source.id, source.status !== 'paused')}
          >
            {source.status === 'paused' ? (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Resume
              </>
            ) : (
              <>
                <Pause className="mr-1.5 h-3.5 w-3.5" />
                Pause
              </>
            )}
          </Button>

          {confirmDisconnect ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 justify-center"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="bg-destructive hover:bg-destructive/90 flex-1 justify-center"
                onClick={() => {
                  onDisconnect?.(source.id);
                  onClose();
                }}
              >
                Confirm Disconnect
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive w-full justify-center"
              onClick={() => setConfirmDisconnect(true)}
            >
              <Unplug className="mr-1.5 h-3.5 w-3.5" />
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
