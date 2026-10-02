'use client';

import { useState } from 'react';
import { cn } from '@repo/ui/utils';
import { GitHubLogo } from '@/components/icons/integration-logos';
import {
  KNOWLEDGE_SOURCE_LOGOS,
  NotionLogo,
  GoogleDriveLogo,
  LinearLogo,
} from './knowledge-source-logos';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceStatus = 'active' | 'syncing' | 'error' | 'paused';

export interface KnowledgeSource {
  id: string;
  provider: string;
  name: string;
  status: SourceStatus;
  items_synced: number;
  change_rate: number; // items changed in last sync
  last_sync: string | null; // ISO date
  storage_bytes: number;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<SourceStatus, { label: string; dotClass: string }> = {
  active: { label: 'Active', dotClass: 'bg-green-400' },
  syncing: { label: 'Syncing', dotClass: 'bg-brand animate-pulse' },
  error: { label: 'Error', dotClass: 'bg-amber-400' },
  paused: { label: 'Paused', dotClass: 'bg-foreground-muted' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SourceIcon({ provider, size = 'sm' }: { provider: string; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';

  if (provider === 'github') return <GitHubLogo className={cls} />;

  const Logo = KNOWLEDGE_SOURCE_LOGOS[provider];
  if (Logo) return <Logo className={cls} />;

  // Fallback
  return <div className={cn('bg-surface-300 rounded', cls)} />;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SourceTableProps {
  sources: KnowledgeSource[];
  onRowClick: (source: KnowledgeSource) => void;
}

export function SourceTable({ sources, onRowClick }: SourceTableProps) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block">
        <table className="w-full">
          <thead>
            <tr className="border-border border-b text-left">
              <th className="text-foreground-lighter px-4 py-3 text-xs font-medium tracking-wider uppercase">
                Source
              </th>
              <th className="text-foreground-lighter px-4 py-3 text-xs font-medium tracking-wider uppercase">
                Status
              </th>
              <th className="text-foreground-lighter px-4 py-3 text-right text-xs font-medium tracking-wider uppercase">
                Items
              </th>
              <th className="text-foreground-lighter px-4 py-3 text-right text-xs font-medium tracking-wider uppercase">
                Change Rate
              </th>
              <th className="text-foreground-lighter px-4 py-3 text-right text-xs font-medium tracking-wider uppercase">
                Last Sync
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const statusCfg = STATUS_CONFIG[source.status];
              return (
                <tr
                  key={source.id}
                  onClick={() => onRowClick(source)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(source);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  className="border-border hover:bg-surface-100 focus-visible:ring-brand cursor-pointer border-b transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-surface-200 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                        <SourceIcon provider={source.provider} />
                      </div>
                      <span className="text-foreground text-sm font-medium">{source.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn('h-2 w-2 rounded-full', statusCfg.dotClass)}
                        aria-hidden="true"
                      />
                      <span className="text-foreground-lighter text-sm">{statusCfg.label}</span>
                    </div>
                  </td>
                  <td className="text-foreground-lighter px-4 py-3 text-right text-sm">
                    {formatNumber(source.items_synced)}
                  </td>
                  <td className="text-foreground-lighter px-4 py-3 text-right text-sm">
                    {source.change_rate > 0 ? `+${formatNumber(source.change_rate)}` : '0'}
                  </td>
                  <td className="text-foreground-lighter px-4 py-3 text-right text-sm">
                    {formatRelativeTime(source.last_sync)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="space-y-2 px-4 md:hidden">
        {sources.map((source) => {
          const statusCfg = STATUS_CONFIG[source.status];
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => onRowClick(source)}
              className="border-border bg-surface-75 hover:bg-surface-100 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
            >
              <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                <SourceIcon provider={source.provider} size="lg" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground truncate text-sm font-medium">
                    {source.name}
                  </span>
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', statusCfg.dotClass)} />
                </div>
                <div className="text-foreground-muted mt-0.5 flex gap-3 text-xs">
                  <span>{formatNumber(source.items_synced)} items</span>
                  <span>{formatRelativeTime(source.last_sync)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

export { SourceIcon };
