'use client';

import { useState, useEffect, useMemo } from 'react';
import { Package, Download, Check, Search, ChevronDown, Loader2 } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import { useWorkspace } from '@/providers/workspace-provider';
import { usePlan } from '@/hooks/use-plan';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import type { SkillPackMinPlan } from '@repo/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillPackData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  pack_category: string;
  min_tier: SkillPackMinPlan;
  version: string;
  author: string;
  icon: string | null;
  skill_count: number | null;
  agent_count: number | null;
  team_type_affinity: Record<string, number> | null;
  installed: boolean;
  installed_at: string | null;
}

const TIER_LABELS: Record<string, string> = {
  builder: 'Builder',
  pro: 'Pro',
  unlimited: 'Unlimited',
};

const TIER_ORDER: Record<string, number> = {
  builder: 0,
  pro: 1,
  unlimited: 2,
};

const PLAN_TIER_RANK: Record<string, number> = {
  builder: 0,
  pro: 1,
  unlimited: 2,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillPackBrowser() {
  const { activeWorkspace } = useWorkspace();
  const { plan } = usePlan();
  const [packs, setPacks] = useState<SkillPackData[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const currentTierRank = PLAN_TIER_RANK[plan] ?? 0;

  // Fetch skill packs
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetchJson<{ data: SkillPackData[] }>(
          apiUrl(`/api/skill-packs?workspace_id=${activeWorkspace!.id}`),
        );
        if (!cancelled) setPacks(res.data ?? []);
      } catch (err) {
        console.error('[skill-pack-browser] Failed to load packs:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  // Install a pack (route uses slug, not ID)
  async function handleInstall(pack: SkillPackData) {
    if (!activeWorkspace?.id || installing) return;
    setInstalling(pack.id);
    try {
      await fetchJson(apiUrl(`/api/skill-packs/${pack.slug}/install`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: activeWorkspace.id }),
      });
      setPacks((prev) =>
        prev.map((p) =>
          p.id === pack.id ? { ...p, installed: true, installed_at: new Date().toISOString() } : p,
        ),
      );
    } catch (err) {
      console.error('[skill-pack-browser] Install failed:', err);
    } finally {
      setInstalling(null);
    }
  }

  // Categories for filter
  const categories = useMemo(() => {
    return [...new Set(packs.map((p) => p.pack_category))].sort();
  }, [packs]);

  // Filtered packs
  const filtered = useMemo(() => {
    return packs.filter((pack) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !pack.name.toLowerCase().includes(q) &&
          !(pack.description ?? '').toLowerCase().includes(q) &&
          !pack.slug.toLowerCase().includes(q)
        )
          return false;
      }
      if (categoryFilter !== 'all' && pack.pack_category !== categoryFilter) return false;
      return true;
    });
  }, [packs, searchQuery, categoryFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-foreground-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="border-border rounded-lg border border-dashed p-12 text-center">
        <Package className="text-foreground-muted mx-auto h-10 w-10" />
        <h2 className="text-foreground mt-4 text-base font-medium">No skill packs available</h2>
        <p className="text-foreground-lighter mt-1 text-sm">
          Skill packs will appear here as they are published.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="text-foreground-lighter pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search packs..."
            aria-label="Search skill packs"
            className="border-border bg-surface-100 text-foreground placeholder:text-foreground-muted hover:border-border-strong focus-visible:border-brand focus-visible:ring-brand/25 w-56 rounded-md border py-1.5 pr-3 pl-8 text-xs transition-colors outline-none focus-visible:ring-2"
          />
        </div>

        {categories.length > 1 && (
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="border-border bg-surface-100 text-foreground-light hover:border-border-strong focus-visible:border-brand focus-visible:ring-brand/25 appearance-none rounded-md border py-1.5 pr-7 pl-3 text-xs transition-colors outline-none focus-visible:ring-2"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                </option>
              ))}
            </select>
            <ChevronDown className="text-foreground-lighter pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2" />
          </div>
        )}

        <span className="text-foreground-muted text-xs">
          {filtered.length} pack{filtered.length !== 1 ? 's' : ''}
          {filtered.filter((p) => p.installed).length > 0 &&
            ` · ${filtered.filter((p) => p.installed).length} installed`}
        </span>
      </div>

      {/* Pack grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((pack) => {
          const locked = (TIER_ORDER[pack.min_tier] ?? 0) > currentTierRank;
          const isInstalling = installing === pack.id;

          return (
            <div
              key={pack.id}
              className={`bg-surface-75 border-border rounded-lg border p-4 transition-colors ${locked ? 'opacity-60' : ''}`}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                  <Package className="text-foreground h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground truncate text-sm font-bold">{pack.name}</span>
                    {locked && (
                      <Badge variant="outline" size="sm">
                        {TIER_LABELS[pack.min_tier] ?? pack.min_tier}
                      </Badge>
                    )}
                  </div>
                  <p className="text-foreground-lighter mt-1 line-clamp-2 text-xs leading-relaxed">
                    {pack.description ?? 'No description'}
                  </p>
                </div>
              </div>

              {/* Meta row */}
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="emerald-dark" size="sm">
                  {pack.pack_category.replace(/-/g, ' ')}
                </Badge>
                {pack.skill_count != null && (
                  <span className="text-foreground-muted text-xs">
                    {pack.skill_count} skill{pack.skill_count !== 1 ? 's' : ''}
                  </span>
                )}
                {pack.agent_count != null && pack.agent_count > 0 && (
                  <span className="text-foreground-muted text-xs">
                    · {pack.agent_count} agent{pack.agent_count !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-foreground-muted ml-auto text-xs">v{pack.version}</span>
              </div>

              {/* Install button */}
              <div className="mt-3">
                {pack.installed ? (
                  <button
                    type="button"
                    disabled
                    className="border-brand/30 text-brand flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Installed
                  </button>
                ) : locked ? (
                  <button
                    type="button"
                    disabled
                    className="border-border text-foreground-muted flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"
                  >
                    Upgrade to {TIER_LABELS[pack.min_tier] ?? pack.min_tier}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleInstall(pack)}
                    disabled={isInstalling}
                    className="bg-brand hover:bg-brand-dark text-brand-foreground flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                  >
                    {isInstalling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Install
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty filtered state */}
      {filtered.length === 0 && (
        <div className="border-border rounded-lg border border-dashed p-12 text-center">
          <Search className="text-foreground-muted mx-auto h-10 w-10" />
          <h2 className="text-foreground mt-4 text-base font-medium">No matching packs</h2>
          <p className="text-foreground-lighter mt-1 text-sm">
            Try adjusting your search or filters.
          </p>
        </div>
      )}
    </div>
  );
}
