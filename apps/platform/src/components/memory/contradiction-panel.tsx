'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useWorkspace } from '@/providers/workspace-provider';
import { fetchJson } from '@/lib/fetch-json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContradictionMemory {
  id: string;
  key: string;
  content: string;
  category: string;
  created_at: string;
}

interface Contradiction {
  relation_id: string;
  memory_a: ContradictionMemory;
  memory_b: ContradictionMemory;
  confidence: number;
}

interface ContradictionsResponse {
  contradictions: Contradiction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contentPreview(content: string, maxLen = 140): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen).trimEnd() + '…';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function confidenceLabel(score: number): string {
  if (score >= 0.8) return 'High';
  if (score >= 0.5) return 'Medium';
  return 'Low';
}

function confidenceColor(score: number): string {
  if (score >= 0.8) return 'text-destructive bg-destructive/15';
  if (score >= 0.5) return 'text-amber-400 bg-amber-500/15';
  return 'text-foreground-lighter bg-surface-300';
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ContradictionSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="border-border bg-surface-100 rounded-xl border p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="bg-surface-200 h-3 w-2/3 animate-pulse rounded" />
              <div className="bg-surface-200 h-3 w-full animate-pulse rounded" />
              <div className="bg-surface-200 h-3 w-4/5 animate-pulse rounded" />
            </div>
            <div className="space-y-2">
              <div className="bg-surface-200 h-3 w-2/3 animate-pulse rounded" />
              <div className="bg-surface-200 h-3 w-full animate-pulse rounded" />
              <div className="bg-surface-200 h-3 w-4/5 animate-pulse rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single contradiction card
// ---------------------------------------------------------------------------

interface ContradictionCardProps {
  item: Contradiction;
  onResolve: (item: Contradiction) => Promise<void>;
  onDismiss: (item: Contradiction) => Promise<void>;
}

function ContradictionCard({ item, onResolve, onDismiss }: ContradictionCardProps) {
  const [resolving, setResolving] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const handleResolve = async () => {
    setResolving(true);
    try {
      await onResolve(item);
    } finally {
      setResolving(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await onDismiss(item);
    } finally {
      setDismissing(false);
    }
  };

  // Determine which is newer (will supersede the older one)
  const aIsNewer = new Date(item.memory_a.created_at) >= new Date(item.memory_b.created_at);
  const newerMemory = aIsNewer ? item.memory_a : item.memory_b;
  const olderMemory = aIsNewer ? item.memory_b : item.memory_a;

  return (
    <div className="border-border bg-surface-100 rounded-xl border p-4">
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400" />
          <span className="text-foreground text-xs font-medium">Contradiction detected</span>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceColor(item.confidence)}`}
        >
          {confidenceLabel(item.confidence)} confidence
        </span>
      </div>

      {/* Side-by-side memory pair */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[item.memory_a, item.memory_b].map((mem, idx) => {
          const isNewer = mem.id === newerMemory.id;
          return (
            <div
              key={mem.id}
              className={`rounded-lg border p-3 ${
                isNewer ? 'border-brand/30 bg-brand/5' : 'border-border bg-surface-200'
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                {isNewer && (
                  <span className="text-brand bg-brand/10 rounded-full px-1.5 py-px text-[9px] font-medium tracking-wide uppercase">
                    Newer
                  </span>
                )}
                <span className="text-foreground-lighter text-[10px]">
                  {idx === 0 ? 'Memory A' : 'Memory B'}
                </span>
              </div>
              <p className="text-foreground mb-1 truncate text-xs font-medium">
                {mem.key || mem.id.slice(0, 12)}
              </p>
              <p className="text-foreground-lighter mb-2 text-[11px] leading-relaxed">
                {contentPreview(mem.content)}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-foreground-muted bg-surface-300 rounded-full px-1.5 py-px text-[10px] capitalize">
                  {mem.category}
                </span>
                <span className="text-foreground-muted text-[10px]">
                  {formatDate(mem.created_at)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action row */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-foreground-muted text-[10px]">
          Resolve will mark{' '}
          <span className="text-foreground font-medium">
            {newerMemory.key || newerMemory.id.slice(0, 8)}
          </span>{' '}
          as superseding{' '}
          <span className="text-foreground font-medium">
            {olderMemory.key || olderMemory.id.slice(0, 8)}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissing || resolving}
            aria-label={`Dismiss contradiction between ${item.memory_a.key || 'Memory A'} and ${item.memory_b.key || 'Memory B'}`}
            className="text-foreground-lighter hover:text-foreground flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
          >
            <X className="h-3 w-3" />
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </button>
          <button
            type="button"
            onClick={handleResolve}
            disabled={resolving || dismissing}
            aria-label={`Resolve contradiction: ${newerMemory.key || 'newer'} supersedes ${olderMemory.key || 'older'}`}
            className="bg-brand/20 text-foreground hover:bg-brand/30 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {resolving ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function ContradictionPanel() {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<ContradictionsResponse>(
        `/api/memory/contradictions?workspace_id=${workspaceId}`,
      );
      setContradictions(res.contradictions ?? []);
    } catch {
      setError('Failed to load contradictions.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resolve: create a supersedes relation (newer supersedes older)
  const handleResolve = useCallback(async (item: Contradiction) => {
    const aIsNewer = new Date(item.memory_a.created_at) >= new Date(item.memory_b.created_at);
    const newerId = aIsNewer ? item.memory_a.id : item.memory_b.id;
    const olderId = aIsNewer ? item.memory_b.id : item.memory_a.id;

    try {
      await fetchJson(`/api/memory/entries/${newerId}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          related_type: 'memory',
          related_id: olderId,
          relation_type: 'supersedes',
          confidence: 1.0,
        }),
      });
      setContradictions((prev) => prev.filter((c) => c.relation_id !== item.relation_id));
    } catch {
      setError('Failed to resolve contradiction. Please try again.');
    }
  }, []);

  // Dismiss: delete the contradiction relation via API
  const handleDismiss = useCallback(async (item: Contradiction) => {
    try {
      await fetchJson(
        `/api/memory/entries/${item.memory_a.id}/relations?relation_id=${item.relation_id}`,
        { method: 'DELETE' },
      );
      setContradictions((prev) => prev.filter((c) => c.relation_id !== item.relation_id));
    } catch {
      setError('Failed to dismiss contradiction. Please try again.');
    }
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const unresolvedCount = contradictions.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-foreground text-sm font-medium">Contradictions</h3>
        {unresolvedCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            {unresolvedCount} unresolved
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && <ContradictionSkeleton />}

      {/* Error */}
      {error && (
        <div
          className="border-destructive/30 bg-destructive/5 flex items-center justify-between rounded-lg border px-4 py-3"
          role="alert"
        >
          <p className="text-destructive text-sm">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="text-destructive hover:text-destructive/80 text-sm font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && contradictions.length === 0 && (
        <div className="border-border flex flex-col items-center rounded-xl border border-dashed py-10 text-center">
          <CheckCircle2 className="text-brand mx-auto h-8 w-8" />
          <p className="text-foreground mt-3 text-sm font-medium">No contradictions found</p>
          <p className="text-foreground-lighter mt-1 text-xs">
            Your knowledge graph is consistent.
          </p>
        </div>
      )}

      {/* Contradiction list */}
      {!loading && contradictions.length > 0 && (
        <div className="space-y-3">
          {contradictions.map((item) => (
            <ContradictionCard
              key={item.relation_id}
              item={item}
              onResolve={handleResolve}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}
