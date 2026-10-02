'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Badge } from '@repo/ui/components/badge';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { IntegrationCard } from '@/components/integration-card';
import { IntegrationDialog } from '@/components/settings/integration-dialog';
import { INTEGRATIONS, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/integrations-registry';
import type { IntegrationId, IntegrationMeta, IntegrationStatusResult } from '@repo/types';

// Map integration IDs to seed memory group keys
const MEMORY_GROUP_MAP: Partial<Record<IntegrationId, string>> = {
  github: 'github',
  slack: 'slack',
  elevenlabs: 'voice',
  anthropic: 'byok',
  openai: 'byok',
  groq: 'byok',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SettingsIntegrationsTabProps {
  onNavigateTab?: (tab: string) => void;
}

export function SettingsIntegrationsTab({ onNavigateTab }: SettingsIntegrationsTabProps) {
  const { activeWorkspace } = useWorkspace();
  const [statuses, setStatuses] = useState<IntegrationStatusResult[]>([]);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [configurableOnly, setConfigurableOnly] = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationMeta | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<IntegrationStatusResult | undefined>();

  const fetchStatuses = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const data = await fetchJson<{
        integrations: IntegrationStatusResult[];
        memoryCounts?: Record<string, number>;
      }>(apiUrl(`/api/integrations/status?workspace_id=${activeWorkspace.id}`));
      setStatuses(data.integrations);
      if (data.memoryCounts) setMemoryCounts(data.memoryCounts);
    } catch {
      // Status fetch failed — show all as disconnected (graceful degradation)
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    setLoading(true);
    fetchStatuses().finally(() => setLoading(false));

    // Re-fetch when user returns to the tab (e.g. after connecting GitHub in a new tab)
    function onVisible() {
      if (document.visibilityState === 'visible') fetchStatuses();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchStatuses]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatuses();
    setRefreshing(false);
  };

  const handleCardClick = (integration: IntegrationMeta) => {
    const status = statuses.find((s) => s.id === integration.id);
    setSelectedIntegration(integration);
    setSelectedStatus(status);
    setDrawerOpen(true);
  };

  // Filter integrations by search + category
  const filteredIntegrations = useMemo(() => {
    let result = INTEGRATIONS;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
      );
    }

    if (selectedCategory) {
      result = result.filter((i) => i.category === selectedCategory);
    }

    if (configurableOnly) {
      result = result.filter((i) => i.integration_type === 'native');
    }

    return result;
  }, [searchQuery, selectedCategory, configurableOnly]);

  // Categories that have items (for filter chips)
  const activeCategories = useMemo(() => {
    return CATEGORY_ORDER.filter((cat) => INTEGRATIONS.some((i) => i.category === cat));
  }, []);

  // Group filtered integrations by category
  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => {
      const items = filteredIntegrations.filter((i) => i.category === cat);
      const connectedCount = items.filter((i) => {
        const s = statuses.find((st) => st.id === i.id);
        return s?.status === 'connected';
      }).length;
      return { category: cat, label: CATEGORY_LABELS[cat], items, connectedCount };
    }).filter((g) => g.items.length > 0);
  }, [filteredIntegrations, statuses]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-foreground-lighter h-6 w-6 animate-spin" />
      </div>
    );
  }

  const totalConnected = statuses.filter((s) => s.status === 'connected').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-foreground text-lg font-medium">Integrations</h2>
          <p className="text-foreground-lighter mt-1 text-sm">
            {totalConnected} connected · {INTEGRATIONS.length} available
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        {/* Search input */}
        <div className="relative min-w-0 flex-1">
          <Search className="text-foreground-lighter absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border bg-surface-100 text-foreground placeholder:text-foreground-lighter/50 w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-1 focus:ring-white/20 focus:outline-none"
          />
        </div>

        {/* Category dropdown */}
        <select
          value={selectedCategory ?? ''}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
          className="border-border bg-surface-100 text-foreground-lighter rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:ring-white/20 focus:outline-none"
        >
          <option value="">All categories</option>
          {activeCategories.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>

        {/* Configurable only checkbox */}
        <label className="text-foreground-lighter flex shrink-0 cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={configurableOnly}
            onChange={(e) => setConfigurableOnly(e.target.checked)}
            className="accent-brand rounded"
          />
          Configurable
        </label>
      </div>

      {/* Results count when filtering */}
      {(searchQuery || selectedCategory) && (
        <p className="text-foreground-lighter text-xs">
          Showing {filteredIntegrations.length} of {INTEGRATIONS.length} integrations
        </p>
      )}

      {/* Category groups */}
      {grouped.map((group) => (
        <div key={group.category}>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-foreground text-sm font-medium">{group.label}</h3>
            <span className="text-foreground-lighter bg-surface-200 rounded-full px-2 py-0.5 text-xs">
              {group.connectedCount}/{group.items.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                status={statuses.find((s) => s.id === integration.id)}
                memoryCount={
                  MEMORY_GROUP_MAP[integration.id]
                    ? (memoryCounts[MEMORY_GROUP_MAP[integration.id]!] ?? 0)
                    : 0
                }
                onClick={() => handleCardClick(integration)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* No results */}
      {grouped.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-foreground-lighter text-sm">No integrations match your search.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory(null);
            }}
            className="text-brand mt-2 text-xs hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Detail dialog */}
      <IntegrationDialog
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        integration={selectedIntegration}
        status={selectedStatus}
        onStatusChange={fetchStatuses}
        onNavigateTab={onNavigateTab}
      />
    </div>
  );
}
