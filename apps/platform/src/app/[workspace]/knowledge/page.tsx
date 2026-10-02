'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Database, BookOpen, Loader2 } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { useWorkspace } from '@/providers/workspace-provider';
import { PageActionBar } from '@/components/page-action-bar';
import { SourceTable } from '@/components/knowledge/source-table';
import { SourceDetailDrawer } from '@/components/knowledge/source-detail-drawer';
import { AddSourceModal } from '@/components/knowledge/add-source-modal';
import type { KnowledgeSource } from '@/components/knowledge/source-table';
import { GitHubLogo } from '@/components/icons/integration-logos';
import {
  NotionLogo,
  GoogleDriveLogo,
  LinearLogo,
} from '@/components/knowledge/knowledge-source-logos';
import { apiUrl } from '@repo/db/api';

const STORAGE_LIMIT = 1_000_000_000; // 1GB tier limit

// ---------------------------------------------------------------------------
// Storage meter
// ---------------------------------------------------------------------------

function StorageMeter({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number }) {
  const pct = Math.min((usedBytes / limitBytes) * 100, 100);
  const usedLabel =
    usedBytes >= 1_000_000_000
      ? `${(usedBytes / 1_000_000_000).toFixed(1)} GB`
      : `${(usedBytes / 1_000_000).toFixed(0)} MB`;
  const limitLabel =
    limitBytes >= 1_000_000_000
      ? `${(limitBytes / 1_000_000_000).toFixed(0)} GB`
      : `${(limitBytes / 1_000_000).toFixed(0)} MB`;

  return (
    <div className="flex items-center gap-3">
      <Database className="text-foreground-muted h-4 w-4 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="bg-surface-300 h-2 w-24 overflow-hidden rounded-full">
          <div
            className="bg-brand h-full rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-foreground-muted shrink-0 text-xs">
          {usedLabel} / {limitLabel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const quickLinks = [
    { id: 'notion', name: 'Notion', Icon: NotionLogo },
    { id: 'google-drive', name: 'Google Drive', Icon: GoogleDriveLogo },
    { id: 'github', name: 'GitHub', Icon: GitHubLogo },
    { id: 'linear', name: 'Linear', Icon: LinearLogo },
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="bg-surface-200 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
        <BookOpen className="text-foreground-muted h-6 w-6" />
      </div>
      <h2 className="text-foreground text-lg font-semibold">Connect your first knowledge source</h2>
      <p className="text-foreground-muted mt-1 max-w-sm text-center text-sm">
        Give your agents access to your docs, code, and conversations so they can work with full
        context.
      </p>

      <div className="mt-6 flex gap-3">
        {quickLinks.map(({ id, name, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={onAdd}
            className="border-border bg-surface-100 hover:bg-surface-200 flex flex-col items-center gap-2 rounded-lg border px-5 py-3 transition-colors"
          >
            <Icon className="h-6 w-6" />
            <span className="text-foreground-lighter text-xs">{name}</span>
          </button>
        ))}
      </div>

      <Button onClick={onAdd} size="sm" className="mt-6">
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add Source
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgePage() {
  const { activeWorkspace } = useWorkspace();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<KnowledgeSource | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchSources = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/knowledge/sources?workspace_id=${activeWorkspace.id}`));
      if (!res.ok) {
        if (res.status === 401 || res.status === 403)
          throw new Error('Not authorized to view knowledge sources');
        if (res.status >= 500) throw new Error('Server error — please try again later');
        throw new Error('Failed to load sources');
      }
      const data = await res.json();
      setSources(
        data.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          provider: s.provider as string,
          name: (s.display_name as string) || (s.provider as string),
          status: (s.status as KnowledgeSource['status']) || 'active',
          items_synced: (s.items_count as number) || 0,
          change_rate: 0,
          last_sync: (s.last_sync_at as string) || null,
          storage_bytes: (s.storage_bytes as number) || 0,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const totalStorage = useMemo(
    () => sources.reduce((sum, s) => sum + s.storage_bytes, 0),
    [sources],
  );

  const handleRowClick = (source: KnowledgeSource) => {
    setSelectedSource(source);
    setDrawerOpen(true);
  };

  const isEmpty = sources.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Action bar */}
      <PageActionBar>
        <div className="flex items-center gap-2">
          <h1 className="text-foreground text-sm font-semibold">Knowledge</h1>
          {!isEmpty && (
            <span className="text-foreground-muted text-xs">
              {sources.length} source{sources.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isEmpty && <StorageMeter usedBytes={totalStorage} limitBytes={STORAGE_LIMIT} />}
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Source
          </Button>
        </div>
      </PageActionBar>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <Loader2 className="text-foreground-muted h-6 w-6 animate-spin" />
          <p className="text-foreground-muted text-sm">Loading sources...</p>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20">
          <p className="text-foreground-muted text-sm">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchSources}
            disabled={loading}
            className="mt-3"
          >
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Retry
          </Button>
        </div>
      ) : isEmpty ? (
        <EmptyState onAdd={() => setModalOpen(true)} />
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          <SourceTable sources={sources} onRowClick={handleRowClick} />
        </div>
      )}

      {/* Detail drawer */}
      <SourceDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        source={selectedSource}
        onResync={(_id) => {
          // TODO: call API
        }}
        onTogglePause={(_id, _paused) => {
          // TODO: call API
        }}
        onDisconnect={(_id) => {
          // TODO: call API
        }}
      />

      {/* Add source modal */}
      <AddSourceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        workspaceId={activeWorkspace?.id}
      />
    </div>
  );
}
