'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronDown, Package } from 'lucide-react';
import { PageActionBar } from '@/components/page-action-bar';
import { SkillCard } from '@/components/skill-card';
import { SkillDetailDrawer } from '@/components/skill-detail-drawer';
import { SkillPackBrowser } from '@/components/skill-pack-browser';
import {
  SKILL_CATALOG,
  CATEGORY_META,
  TRIGGER_META,
  getAllowedSkillTiers,
  type SkillCatalogEntry,
  type SkillTrigger,
  type SkillCategory,
} from '@/lib/skill-catalog';
import { usePlan } from '@/hooks/use-plan';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type TriggerFilter = 'all' | SkillTrigger;
type CategoryFilter = 'all' | SkillCategory;
type PageTab = 'skills' | 'packs';

export default function SkillsPage() {
  const [activeTab, setActiveTab] = useState<PageTab>('skills');
  const [searchQuery, setSearchQuery] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillCatalogEntry | null>(null);
  const { features, isPlatformOwner } = usePlan();

  // Determine which skill tiers are unlocked for this plan
  const allowedTiers = useMemo(
    () =>
      isPlatformOwner
        ? new Set(['essential', 'standard', 'premium'] as const)
        : getAllowedSkillTiers(features),
    [features, isPlatformOwner],
  );

  // Filter skills
  const filtered = useMemo(() => {
    return SKILL_CATALOG.filter((skill) => {
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesCommand = skill.command.toLowerCase().includes(q);
        const matchesTitle = skill.title.toLowerCase().includes(q);
        const matchesDesc = skill.description.toLowerCase().includes(q);
        if (!matchesCommand && !matchesTitle && !matchesDesc) return false;
      }
      // Trigger filter
      if (triggerFilter !== 'all' && skill.trigger !== triggerFilter) return false;
      // Category filter
      if (categoryFilter !== 'all' && skill.category !== categoryFilter) return false;
      return true;
    });
  }, [searchQuery, triggerFilter, categoryFilter]);

  // Group by trigger type for section headers
  const slashCommands = filtered.filter((s) => s.trigger === 'slash');
  const automatedWorkflows = filtered.filter((s) => s.trigger === 'auto');
  const protocols = filtered.filter((s) => s.trigger === 'protocol');

  // Get active categories for the filter dropdown
  const activeCategories = useMemo(() => {
    return [...new Set(SKILL_CATALOG.map((s) => s.category))].sort();
  }, []);

  // Counts for the action bar
  const totalCount = SKILL_CATALOG.length;
  const slashCount = SKILL_CATALOG.filter((s) => s.trigger === 'slash').length;
  const autoCount = SKILL_CATALOG.filter((s) => s.trigger === 'auto').length;

  return (
    <div className="flex min-h-full flex-col">
      <PageActionBar>
        <div className="flex items-center gap-4">
          <span className="text-foreground text-xl font-medium">Skills</span>
          <div className="flex items-center gap-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'skills'}
              onClick={() => setActiveTab('skills')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'skills'
                  ? 'bg-surface-200 text-foreground'
                  : 'text-foreground-lighter hover:text-foreground'
              }`}
            >
              Catalog ({totalCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'packs'}
              onClick={() => setActiveTab('packs')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'packs'
                  ? 'bg-surface-200 text-foreground'
                  : 'text-foreground-lighter hover:text-foreground'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              Skill Packs
            </button>
          </div>
        </div>
      </PageActionBar>

      {activeTab === 'packs' ? (
        <div className="p-6">
          <SkillPackBrowser />
        </div>
      ) : (
        <div className="space-y-8 p-6">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="text-foreground-lighter pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search skills..."
                aria-label="Search skills"
                className="border-border bg-surface-100 text-foreground placeholder:text-foreground-muted hover:border-border-strong focus-visible:border-brand focus-visible:ring-brand/25 w-56 rounded-md border py-1.5 pr-3 pl-8 text-xs transition-colors outline-none focus-visible:ring-2"
              />
            </div>

            {/* Category filter */}
            <div className="relative">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                aria-label="Filter by category"
                className="border-border bg-surface-100 text-foreground-light hover:border-border-strong focus-visible:border-brand focus-visible:ring-brand/25 appearance-none rounded-md border py-1.5 pr-7 pl-3 text-xs transition-colors outline-none focus-visible:ring-2"
              >
                <option value="all">All categories</option>
                {activeCategories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-foreground-lighter pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2" />
            </div>

            {/* Trigger type pills */}
            <div className="flex items-center gap-1.5" role="group" aria-label="Filter by type">
              {(
                [
                  { value: 'all', label: `All (${totalCount})` },
                  { value: 'slash', label: `Commands (${slashCount})` },
                  { value: 'auto', label: `Automated (${autoCount})` },
                  {
                    value: 'protocol',
                    label: `Protocols (${SKILL_CATALOG.filter((s) => s.trigger === 'protocol').length})`,
                  },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTriggerFilter(value)}
                  aria-pressed={triggerFilter === value}
                  className={`focus-visible:ring-brand/25 rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 ${
                    triggerFilter === value
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border text-foreground-lighter hover:border-border-strong hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Slash Commands Section */}
          {slashCommands.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-foreground text-sm font-bold">Slash Commands</h2>
                <span className="text-foreground-muted text-xs">
                  {'Invoked with /<command> in the CLI'}
                </span>
              </div>

              {/* Group by category */}
              {activeCategories
                .filter((cat) => slashCommands.some((s) => s.category === cat))
                .map((cat) => {
                  const catMeta = CATEGORY_META[cat];
                  const CatIcon = catMeta.icon;
                  const catSkills = slashCommands.filter((s) => s.category === cat);

                  return (
                    <div key={cat} className="mb-5">
                      <div className="mb-2 flex items-center gap-1.5">
                        <CatIcon className="text-foreground-lighter h-3.5 w-3.5" />
                        <h3 className="text-foreground-lighter text-xs font-medium tracking-wide uppercase">
                          {catMeta.label}
                        </h3>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {catSkills.map((skill) => (
                          <SkillCard
                            key={skill.command}
                            skill={skill}
                            onClick={() => setSelectedSkill(skill)}
                            locked={!allowedTiers.has(skill.tier)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </section>
          )}

          {/* Automated Workflows Section */}
          {automatedWorkflows.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-foreground text-sm font-bold">Automated Workflows</h2>
                <span className="text-foreground-muted text-xs">
                  Triggered automatically by hooks and events
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {automatedWorkflows.map((skill) => (
                  <SkillCard
                    key={skill.command}
                    skill={skill}
                    onClick={() => setSelectedSkill(skill)}
                    locked={!allowedTiers.has(skill.tier)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Protocol Skills Section */}
          {protocols.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-foreground text-sm font-bold">Agent Protocols</h2>
                <span className="text-foreground-muted text-xs">
                  Internal protocols used by agents automatically
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {protocols.map((skill) => (
                  <SkillCard
                    key={skill.command}
                    skill={skill}
                    onClick={() => setSelectedSkill(skill)}
                    locked={!allowedTiers.has(skill.tier)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {filtered.length === 0 && (
            <div className="border-border rounded-lg border border-dashed p-12 text-center">
              <Search className="text-foreground-muted mx-auto h-10 w-10" />
              <h2 className="text-foreground mt-4 text-base font-medium">No matching skills</h2>
              <p className="text-foreground-lighter mt-1 text-sm">
                Try adjusting your search or filters.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Detail drawer (always rendered for animation) */}
      <SkillDetailDrawer
        open={!!selectedSkill}
        skill={selectedSkill}
        onClose={() => setSelectedSkill(null)}
      />
    </div>
  );
}
