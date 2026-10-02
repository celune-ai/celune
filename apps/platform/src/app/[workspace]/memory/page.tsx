'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Brain,
  Search,
  Lock,
  ChevronDown,
  Sparkles,
  Plus,
  X,
  GitFork,
  AlertTriangle,
} from 'lucide-react';
import { PageActionBar } from '@/components/page-action-bar';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { MemoryLayoutProvider, useMemoryLayout } from '@/providers/memory-layout-provider';
import {
  MemoryLayout,
  MemoryDetailLayout,
  MemoryLayoutSkeleton,
} from '@/components/memory/memory-layout';
import { MemoryCategorySidebar } from '@/components/memory/memory-category-sidebar';
import { MemoryInsightsPanel } from '@/components/memory/memory-insights-panel';
import { MemoryCardList } from '@/components/memory/memory-card-list';
import { MemoryContentView } from '@/components/memory/memory-content-view';
import { summarizeTitle } from '@/components/memory/memory-card';
import { fetchJson } from '@/lib/fetch-json';
import type { AgentMemory, MemoryCategory } from '@repo/types';
import { MEMORY_CATEGORIES } from '@repo/types';
import { MemoryGraph } from '@/components/memory/memory-graph';
import { ContradictionPanel } from '@/components/memory/contradiction-panel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryListResponse {
  data: AgentMemory[];
  total: number;
}

interface SemanticSearchResponse {
  results: AgentMemory[];
  mode: 'semantic' | 'keyword';
}

interface MemoryLimitInfo {
  count: number;
  limit: number | null;
  plan: string;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Memory content (center panel)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 30;

function MemoryContent() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const { activeCategory, setActiveCategory } = useMemoryLayout();
  const workspaceId = activeWorkspace?.id;

  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [memoryLimit, setMemoryLimit] = useState<MemoryLimitInfo | null>(null);

  // Filters
  const [filterSource, setFilterSource] = useState<string>('all');
  const filterCategory = activeCategory ?? 'all';

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const [searchMode, setSearchMode] = useState<'semantic' | 'keyword' | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AgentMemory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<'memories' | 'graph' | 'contradictions'>('memories');

  // Add memory dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addContent, setAddContent] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  // Selected memory for content view
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);

  // Graph seed — use the selected memory or first loaded memory
  const graphSeedId = selectedMemoryId ?? memories[0]?.id;

  // Fetch memories (paginated, filtered)
  const fetchMemories = useCallback(
    async (newOffset = 0, append = false) => {
      if (!workspaceId) return;
      if (newOffset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          workspace_id: workspaceId,
          limit: String(PAGE_SIZE),
          offset: String(newOffset),
        });
        if (filterSource !== 'all') params.set('source', filterSource);
        if (filterCategory !== 'all') params.set('category', filterCategory);

        const result = await fetchJson<MemoryListResponse>(
          `/api/memory/entries?${params.toString()}`,
        );
        setTotal(result.total);
        setMemories((prev) => (append ? [...prev, ...result.data] : result.data));
        setOffset(newOffset + result.data.length);
      } catch {
        setError('Failed to load memories. Please try again.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [workspaceId, filterSource, filterCategory],
  );

  // Fetch memory limit info
  useEffect(() => {
    if (!workspaceId) return;
    fetchJson<MemoryLimitInfo>(`/api/memory/limit?workspace_id=${workspaceId}`)
      .then(setMemoryLimit)
      .catch(() => {
        /* Non-critical — page works without limit info */
      });
  }, [workspaceId]);

  // Re-fetch on filter changes
  useEffect(() => {
    setSearchResults(null);
    setSearchQuery('');
    setOffset(0);
    setSelectedMemoryId(null);
    void fetchMemories(0, false);
  }, [fetchMemories]);

  // Debounced fuzzy keyword search (local filtering)
  const fuzzyFilteredMemories = useMemo(() => {
    if (!debouncedQuery.trim() || searchResults !== null) return null;
    const terms = debouncedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;

    return memories.filter((m) => {
      const text =
        `${m.key ?? ''} ${m.content} ${m.category} ${m.agent_id} ${m.tags ?? ''}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [debouncedQuery, memories, searchResults]);

  // Semantic search (server-side)
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q, limit: '30', threshold: '0.4' });
      if (workspaceId) params.set('workspace_id', workspaceId);
      const res = await fetchJson<SemanticSearchResponse>(
        `/api/memory/semantic-search?${params.toString()}`,
      );
      setSearchResults(res.results);
      setSearchMode(res.mode);
    } catch {
      setSearchResults([]);
      setError('Search failed. Try a different query.');
    } finally {
      setSearching(false);
    }
  }

  function handleClearSearch() {
    setSearchQuery('');
    setSearchResults(null);
    setSearchMode(null);
  }

  function handleDelete(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    setSearchResults((prev) => (prev ? prev.filter((m) => m.id !== id) : null));
    setTotal((prev) => Math.max(0, prev - 1));
    if (selectedMemoryId === id) setSelectedMemoryId(null);
  }

  function handleUpdate(id: string, patch: { content: string; category: MemoryCategory }) {
    const updater = (m: AgentMemory) =>
      m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m;
    setMemories((prev) => prev.map(updater));
    setSearchResults((prev) => (prev ? prev.map(updater) : null));
  }

  function handleRead(id: string) {
    setSelectedMemoryId(id);
    window.history.pushState({ memoryDetail: true }, '');
  }

  function handleBack() {
    setSelectedMemoryId(null);
  }

  // Listen for browser back button to close detail view
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      if (selectedMemoryId) {
        setSelectedMemoryId(null);
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectedMemoryId]);

  async function handleAddMemory() {
    if (!addTitle.trim() || !addContent.trim() || !workspaceId) return;
    setAddSaving(true);
    try {
      const key = `user:${addTitle
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80)}`;
      await fetchJson<{ id: string; key: string }>('/api/memory/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          content: addContent.trim(),
          source: 'user',
          category: 'general',
          workspace_id: workspaceId,
        }),
      });
      // Refetch to get the full memory object
      setShowAddDialog(false);
      setAddTitle('');
      setAddContent('');
      setTotal((prev) => prev + 1);
      void fetchMemories(0, false);
    } catch {
      setError('Failed to add memory. Please try again.');
    } finally {
      setAddSaving(false);
    }
  }

  // Resolve displayed memories: semantic search > fuzzy filter > full list
  // Sort core memories to the bottom so user-created memories appear first
  const sortedMemories = useMemo(() => {
    const base = searchResults ?? fuzzyFilteredMemories ?? memories;
    return [...base].sort((a, b) => {
      const aCore = a.is_core || a.source === 'brain-seed' ? 1 : 0;
      const bCore = b.is_core || b.source === 'brain-seed' ? 1 : 0;
      return aCore - bCore;
    });
  }, [searchResults, fuzzyFilteredMemories, memories]);
  const displayedMemories = sortedMemories;
  const hasMore =
    searchResults === null && fuzzyFilteredMemories === null && memories.length < total;

  // Build category counts for sidebar
  const categoryCounts = displayedMemories.reduce<Record<string, number>>((acc, m) => {
    acc[m.category] = (acc[m.category] ?? 0) + 1;
    return acc;
  }, {});
  const categoryCountsList = Object.entries(categoryCounts).map(([category, count]) => ({
    category,
    count,
    isCustom: !MEMORY_CATEGORIES.includes(category as MemoryCategory),
  }));

  // Selected memory + related memories for content view
  const selectedMemory = selectedMemoryId
    ? (displayedMemories.find((m) => m.id === selectedMemoryId) ??
      memories.find((m) => m.id === selectedMemoryId))
    : null;

  const relatedMemories = useMemo(() => {
    if (!selectedMemory) return [];
    return memories
      .filter(
        (m) =>
          m.id !== selectedMemory.id &&
          (m.category === selectedMemory.category || m.agent_id === selectedMemory.agent_id),
      )
      .slice(0, 5);
  }, [selectedMemory, memories]);

  // --- Content view (detail) ---
  if (selectedMemory) {
    const memoryTitle = summarizeTitle(selectedMemory);

    const contentNode = (
      <MemoryContentView
        memory={selectedMemory}
        relatedMemories={relatedMemories}
        onBack={handleBack}
        onDelete={handleDelete}
        onUpdate={handleUpdate}
      />
    );

    const metadataNode = (
      <div className="space-y-6 p-4">
        <section>
          <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
            Details
          </h3>
          <dl className="space-y-2.5 text-xs">
            <div>
              <dt className="text-foreground-lighter mb-0.5">Type</dt>
              <dd className="text-foreground">
                {selectedMemory.is_core || selectedMemory.source === 'brain-seed' ? (
                  <span className="bg-surface-300 text-foreground-lighter inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium">
                    Core
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-400">
                    New
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-lighter mb-0.5">Category</dt>
              <dd className="text-foreground capitalize">{selectedMemory.category}</dd>
            </div>
            <div>
              <dt className="text-foreground-lighter mb-0.5">Source</dt>
              <dd className="text-foreground">{selectedMemory.source}</dd>
            </div>
            <div>
              <dt className="text-foreground-lighter mb-0.5">Memory Type</dt>
              <dd className="text-foreground">{selectedMemory.memory_type}</dd>
            </div>
            {selectedMemory.key && (
              <div>
                <dt className="text-foreground-lighter mb-0.5">Key</dt>
                <dd className="text-foreground truncate font-mono text-[11px]">
                  {selectedMemory.key}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-foreground-lighter mb-0.5">Agent</dt>
              <dd className="text-foreground truncate font-mono text-[11px]">
                {selectedMemory.agent_id}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-lighter mb-0.5">Version</dt>
              <dd className="text-foreground">{selectedMemory.version}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
            Timeline
          </h3>
          <dl className="space-y-2.5 text-xs">
            <div>
              <dt className="text-foreground-lighter mb-0.5">Created</dt>
              <dd className="text-foreground">
                {new Date(selectedMemory.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </dd>
            </div>
            <div>
              <dt className="text-foreground-lighter mb-0.5">Updated</dt>
              <dd className="text-foreground">
                {new Date(selectedMemory.updated_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </dd>
            </div>
            {selectedMemory.last_accessed_at && (
              <div>
                <dt className="text-foreground-lighter mb-0.5">Last Accessed</dt>
                <dd className="text-foreground">
                  {new Date(selectedMemory.last_accessed_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {(selectedMemory.importance_score > 0 || selectedMemory.access_count > 0) && (
          <section>
            <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
              Usage
            </h3>
            <dl className="space-y-2.5 text-xs">
              {selectedMemory.importance_score > 0 && (
                <div>
                  <dt className="text-foreground-lighter mb-0.5">Importance</dt>
                  <dd className="text-foreground">{selectedMemory.importance_score}</dd>
                </div>
              )}
              {selectedMemory.access_count > 0 && (
                <div>
                  <dt className="text-foreground-lighter mb-0.5">Access Count</dt>
                  <dd className="text-foreground">{selectedMemory.access_count}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {selectedMemory.tags && (
          <section>
            <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
              Tags
            </h3>
            <p className="text-foreground text-xs">{selectedMemory.tags}</p>
          </section>
        )}
      </div>
    );

    return (
      <>
        <PageActionBar>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBack}
              className="text-foreground-lighter hover:text-foreground text-xl font-medium transition-colors"
            >
              Memory
            </button>
            <span className="text-foreground-muted text-xl">/</span>
            <span className="text-foreground min-w-0 truncate text-xl font-medium">
              {memoryTitle}
            </span>
          </div>
        </PageActionBar>

        <MemoryDetailLayout content={contentNode} metadata={metadataNode} />
      </>
    );
  }

  // --- Card grid view (default) ---
  const contentNode = (
    <div className="space-y-4 p-6">
      {/* Search bar */}
      <form
        onSubmit={handleSearch}
        className="flex gap-2"
        role="search"
        aria-label="Search memories"
      >
        <div className="relative flex-1">
          <Search
            className="text-foreground-lighter absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type to filter, or press Search for semantic results..."
            aria-label="Search memories"
            className="border-border bg-surface-100 text-foreground placeholder:text-foreground-lighter focus:border-border-strong focus:ring-brand w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:ring-1 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={searching || !searchQuery.trim()}
          className="bg-surface-300 text-foreground hover:bg-surface-400 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {searching ? 'Searching...' : 'Search'}
        </button>
        {searchResults !== null && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="border-border text-foreground-lighter hover:text-foreground rounded-lg border px-3 py-2 text-sm transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Source quick filters */}
        <div className="flex items-center gap-2" role="group" aria-label="Filter by source">
          {(['all', 'user', 'agent', 'system'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterSource(s)}
              aria-pressed={filterSource === s}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filterSource === s
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-foreground-lighter hover:border-border-strong hover:text-foreground'
              }`}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        {/* Category filter dropdown (mobile — sidebar hidden) */}
        <div className="relative lg:hidden">
          <select
            value={filterCategory}
            onChange={(e) => setActiveCategory(e.target.value === 'all' ? null : e.target.value)}
            aria-label="Filter by category"
            className="border-border bg-surface-100 text-foreground-light hover:border-border-strong appearance-none rounded-md border py-1.5 pr-7 pl-3 text-xs transition-colors"
          >
            <option value="all">All categories</option>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <ChevronDown className="text-foreground-lighter pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2" />
        </div>

        {/* Result count indicators */}
        {fuzzyFilteredMemories !== null && searchResults === null && (
          <span className="text-foreground-lighter text-xs">
            {fuzzyFilteredMemories.length} match{fuzzyFilteredMemories.length !== 1 ? 'es' : ''} for{' '}
            <span className="text-brand font-medium">&ldquo;{debouncedQuery}&rdquo;</span>
          </span>
        )}

        {searchResults !== null && searchMode && (
          <span className="text-foreground-lighter text-xs">
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} via{' '}
            <span className="text-brand font-medium">{searchMode}</span> search
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div
          className="border-destructive/30 bg-destructive/5 flex items-center justify-between rounded-lg border px-4 py-3"
          role="alert"
        >
          <p className="text-destructive text-sm">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              void fetchMemories(0, false);
            }}
            className="text-destructive hover:text-destructive/80 text-sm font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-border bg-surface-75 rounded-xl border p-5">
              <div className="bg-surface-200 mb-3 h-5 w-3/4 animate-pulse rounded" />
              <div className="bg-surface-200 mb-2 h-3 w-full animate-pulse rounded" />
              <div className="bg-surface-200 mb-4 h-3 w-2/3 animate-pulse rounded" />
              <div className="flex gap-2">
                <div className="bg-surface-200 h-5 w-12 animate-pulse rounded-full" />
                <div className="bg-surface-200 h-5 w-16 animate-pulse rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty states */}
      {!loading && displayedMemories.length === 0 && (
        <div className="border-border rounded-lg border border-dashed p-12 text-center">
          <Brain className="text-foreground-muted mx-auto h-10 w-10" />
          {searchResults !== null || fuzzyFilteredMemories !== null ? (
            <>
              <h2 className="text-foreground mt-4 text-base font-medium">No results found</h2>
              <p className="text-foreground-lighter mt-1 text-sm">
                Try a different query or clear the search to browse all memories.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-foreground mt-4 text-base font-medium">No memories yet</h2>
              <p className="text-foreground-lighter mt-1 text-sm">
                Memories are created automatically as agents learn about your preferences and
                decisions.
              </p>
            </>
          )}
        </div>
      )}

      {/* Memory card grid */}
      {!loading && displayedMemories.length > 0 && (
        <MemoryCardList
          memories={displayedMemories}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
          onRead={handleRead}
          loadingMore={loadingMore}
        />
      )}

      {/* Load more */}
      {hasMore && (
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => void fetchMemories(offset, true)}
            disabled={loadingMore}
            className="border-border text-foreground-lighter hover:text-foreground hover:border-border-strong rounded-lg border px-6 py-2 text-sm transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : `Load more (${total - memories.length} remaining)`}
          </button>
        </div>
      )}

      {/* Read-only note */}
      <p className="text-foreground-muted flex items-center gap-1 text-xs">
        <Lock className="h-3 w-3" />
        System and core memories are read-only and cannot be edited or deleted.
      </p>
    </div>
  );

  return (
    <>
      <PageActionBar>
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-foreground text-xl font-medium">Memory</span>
            {memoryLimit !== null ? (
              <span className="text-foreground-lighter text-sm tabular-nums">
                {memoryLimit.count.toLocaleString()}
                {memoryLimit.limit !== null ? ` / ${memoryLimit.limit.toLocaleString()}` : ''} memor
                {memoryLimit.count === 1 ? 'y' : 'ies'}
                {memoryLimit.limit !== null && memoryLimit.count >= memoryLimit.limit && (
                  <span className="text-destructive ml-1.5 font-medium">
                    -- limit reached.{' '}
                    <a
                      href={workspaceHref('/settings?tab=billing')}
                      className="underline underline-offset-2"
                    >
                      Upgrade
                    </a>
                  </span>
                )}
              </span>
            ) : !loading ? (
              <span className="text-foreground-lighter text-sm tabular-nums">
                {total.toLocaleString()} memor{total === 1 ? 'y' : 'ies'}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowAddDialog(true)}
            className="bg-brand/20 text-foreground hover:bg-brand/30 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Memory
          </button>
        </div>
      </PageActionBar>

      {/* Tab bar */}
      <div
        className="border-border flex gap-1 border-b px-6 pt-1"
        role="tablist"
        aria-label="Memory views"
      >
        {(
          [
            { id: 'memories', icon: Brain, label: 'Memories' },
            { id: 'graph', icon: GitFork, label: 'Graph' },
            { id: 'contradictions', icon: AlertTriangle, label: 'Contradictions' },
          ] as const
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setActiveTab(id)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === id
                ? 'border-brand text-foreground'
                : 'text-foreground-lighter hover:text-foreground border-transparent'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'graph' ? (
        <div className="px-6 py-4">
          <MemoryGraph
            seedMemoryId={graphSeedId}
            onNodeClick={(id) => {
              setSelectedMemoryId(id);
              setActiveTab('memories');
            }}
            onSwitchTab={(tab) => setActiveTab(tab as typeof activeTab)}
          />
        </div>
      ) : activeTab === 'contradictions' ? (
        <div className="px-6 py-4">
          <ContradictionPanel />
        </div>
      ) : (
        <MemoryLayout
          sidebar={
            <MemoryCategorySidebar
              categories={categoryCountsList}
              activeCategory={activeCategory}
              onCategorySelect={setActiveCategory}
            />
          }
          content={contentNode}
          insights={<MemoryInsightsPanel />}
        />
      )}

      {/* Add Memory Dialog */}
      {showAddDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAddDialog(false);
              setAddTitle('');
              setAddContent('');
            }
          }}
        >
          <div className="border-border bg-surface-100 w-full max-w-lg rounded-xl border p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-foreground text-lg font-semibold">Add Memory</h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddDialog(false);
                  setAddTitle('');
                  setAddContent('');
                }}
                className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="add-memory-title"
                  className="text-foreground-lighter mb-1.5 block text-xs font-medium"
                >
                  Title
                </label>
                <input
                  id="add-memory-title"
                  type="text"
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  placeholder="e.g. Design system colors, API conventions..."
                  className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-border-strong focus:ring-brand w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label
                  htmlFor="add-memory-content"
                  className="text-foreground-lighter mb-1.5 block text-xs font-medium"
                >
                  Content
                </label>
                <textarea
                  id="add-memory-content"
                  value={addContent}
                  onChange={(e) => setAddContent(e.target.value)}
                  placeholder="Notes, links, documents, decisions — anything your agents should remember."
                  rows={8}
                  className="border-border bg-surface-200 text-foreground placeholder:text-foreground-lighter focus:border-border-strong focus:ring-brand w-full rounded-lg border px-3 py-2 text-sm leading-relaxed focus:ring-1 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddDialog(false);
                  setAddTitle('');
                  setAddContent('');
                }}
                className="text-foreground-lighter hover:text-foreground rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddMemory}
                disabled={addSaving || !addTitle.trim() || !addContent.trim()}
                className="bg-brand hover:bg-brand/90 rounded-lg px-4 py-2 text-sm font-medium text-black transition-colors disabled:opacity-40"
              >
                {addSaving ? 'Saving...' : 'Save Memory'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page (wrapped with provider)
// ---------------------------------------------------------------------------

export default function MemoryPage() {
  return (
    <MemoryLayoutProvider>
      <MemoryContent />
    </MemoryLayoutProvider>
  );
}
