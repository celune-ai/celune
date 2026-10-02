'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  Bot,
  ChevronRight,
  Code,
  Megaphone,
  PenTool,
  Briefcase,
  Palette,
  Settings,
  Scale,
  User,
  Search,
  Loader2,
  X,
  Users,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@repo/ui/components/dialog';
import { fetchJson } from '@/lib/fetch-json';
import type { TeamTemplate, TeamCategory, AgentTemplate } from '@repo/db/team-templates';

// ---------------------------------------------------------------------------
// Category icon map
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<TeamCategory, React.ElementType> = {
  software: Code,
  marketing: Megaphone,
  content: PenTool,
  business: Briefcase,
  creative: Palette,
  operations: Settings,
  'professional-services': Scale,
  personal: User,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateResponse {
  templates: TeamTemplate[];
  categories: Record<TeamCategory, { label: string; description: string }>;
  stats: { templates: number; agents: number; categories: number };
}

/** The user's lead agent created during onboarding */
interface UserLeadAgent {
  agent_id: string;
  display_name: string;
  color: string;
  avatar_url?: string | null;
}

interface TeamTemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  workspaceId?: string;
  /** The user's lead agent — replaces the generic 'lead' slot in templates */
  userLeadAgent?: UserLeadAgent | null;
}

// ---------------------------------------------------------------------------
// Template card
// ---------------------------------------------------------------------------

function TemplateCard({
  template,
  onSelect,
  userLeadAgent,
}: {
  template: TeamTemplate;
  onSelect: (t: TeamTemplate) => void;
  userLeadAgent?: UserLeadAgent | null;
}) {
  const Icon = CATEGORY_ICONS[template.category] ?? Bot;

  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className="bg-surface-75 border-border hover:border-brand/40 hover:bg-surface-100 group flex flex-col gap-3 rounded-lg border p-4 text-left transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="bg-surface-200 flex h-10 w-10 items-center justify-center rounded-lg">
          <Icon className="text-foreground h-5 w-5" />
        </div>
        <ChevronRight className="text-foreground-lighter group-hover:text-brand h-4 w-4 opacity-0 transition-all group-hover:opacity-100" />
      </div>
      <div>
        <h3 className="text-foreground text-sm font-medium">{template.name}</h3>
        <p className="text-foreground-lighter mt-0.5 line-clamp-2 text-xs">
          {template.description}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-foreground-lighter text-xs">
          <Users className="mr-1 inline h-3 w-3" />
          {template.agents.length} agents
        </span>
        <span className="text-foreground-lighter text-xs">{template.target_persona}</span>
      </div>
      {/* Agent preview - show first 5 agent colors, replacing lead with user's agent */}
      <div className="flex -space-x-1.5">
        {template.agents.slice(0, 5).map((agent) => {
          const isLead = agent.agent_id === 'lead';
          const color = isLead && userLeadAgent ? userLeadAgent.color : agent.color;
          const name = isLead && userLeadAgent ? userLeadAgent.display_name : agent.display_name;
          return (
            <div
              key={agent.agent_id}
              className="border-surface-75 h-6 w-6 rounded-full border-2"
              style={{ backgroundColor: color }}
              title={name}
            />
          );
        })}
        {template.agents.length > 5 && (
          <div className="bg-surface-200 border-surface-75 text-foreground-lighter flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-medium">
            +{template.agents.length - 5}
          </div>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Template detail view
// ---------------------------------------------------------------------------

function AgentPreviewRow({
  agent,
  userLeadAgent,
}: {
  agent: AgentTemplate;
  userLeadAgent?: UserLeadAgent | null;
}) {
  // Replace the generic 'lead' template agent with the user's actual agent
  const isLeadSlot = agent.agent_id === 'lead';
  const displayName = isLeadSlot && userLeadAgent ? userLeadAgent.display_name : agent.display_name;
  const color = isLeadSlot && userLeadAgent ? userLeadAgent.color : agent.color;
  const role = isLeadSlot ? 'Team Lead' : agent.role;
  const avatarUrl = isLeadSlot && userLeadAgent ? userLeadAgent.avatar_url : null;

  return (
    <div className="border-border flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={{ backgroundColor: color }}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            className="h-full w-full object-cover"
            width={32}
            height={32}
            unoptimized
          />
        ) : (
          <span className="text-xs font-bold text-white">
            {displayName.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-foreground text-sm font-medium">{displayName}</p>
          <span className="text-foreground-lighter text-xs">{role}</span>
          {isLeadSlot && userLeadAgent && (
            <span className="bg-brand/10 text-brand rounded-full px-1.5 py-0.5 text-[10px] font-medium">
              You
            </span>
          )}
        </div>
        <p className="text-foreground-lighter line-clamp-1 text-xs">{agent.description}</p>
      </div>
      <span className="text-foreground-lighter shrink-0 text-[10px] font-medium uppercase">
        {agent.model.includes('opus')
          ? 'Opus'
          : agent.model.includes('sonnet')
            ? 'Sonnet'
            : 'Haiku'}
      </span>
    </div>
  );
}

function TemplateDetail({
  template,
  onBack,
  onGenerate,
  generating,
  userLeadAgent,
}: {
  template: TeamTemplate;
  onBack: () => void;
  onGenerate: () => void;
  generating: boolean;
  userLeadAgent?: UserLeadAgent | null;
}) {
  const Icon = CATEGORY_ICONS[template.category] ?? Bot;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-border flex items-center gap-3 border-b px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          className="text-foreground-lighter hover:text-foreground text-sm transition-colors"
        >
          &larr; Back
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="bg-surface-200 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
            <Icon className="text-foreground h-6 w-6" />
          </div>
          <div>
            <h2 className="text-foreground text-lg font-medium">{template.name}</h2>
            <p className="text-foreground-lighter mt-0.5 text-sm">{template.description}</p>
            <p className="text-foreground-lighter mt-1 text-xs">For: {template.target_persona}</p>
          </div>
        </div>

        {/* Tags */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="bg-surface-200 text-foreground-lighter rounded-full px-2.5 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Agent list */}
        <div className="mt-6">
          <h3 className="text-foreground mb-3 text-sm font-medium">
            Team Members ({template.agents.length})
          </h3>
          <div className="border-border overflow-hidden rounded-lg border">
            {template.agents.map((agent) => (
              <AgentPreviewRow key={agent.agent_id} agent={agent} userLeadAgent={userLeadAgent} />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-border flex items-center justify-end gap-3 border-t px-6 py-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          Cancel
        </Button>
        <Button size="sm" onClick={onGenerate} disabled={generating}>
          {generating ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Generate Team
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main picker component
// ---------------------------------------------------------------------------

export function TeamTemplatePicker({
  open,
  onClose,
  onComplete,
  workspaceId,
  userLeadAgent,
}: TeamTemplatePickerProps) {
  const [data, setData] = useState<TemplateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<TeamCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<TeamTemplate | null>(null);
  const [generating, setGenerating] = useState(false);

  // Fetch templates on open
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchJson<TemplateResponse>('/api/agents/team-templates')
      .then(setData)
      .catch(() => toast.error('Failed to load team templates'))
      .finally(() => setLoading(false));
  }, [open]);

  // Reset state on close
  useEffect(() => {
    if (!open) {
      setSelectedTemplate(null);
      setSearchQuery('');
      setSelectedCategory('all');
    }
  }, [open]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    if (!data) return [];
    let templates = data.templates;
    if (selectedCategory !== 'all') {
      templates = templates.filter((t) => t.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return templates;
  }, [data, selectedCategory, searchQuery]);

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate || !workspaceId) return;
    setGenerating(true);
    try {
      const result = await fetchJson<{ seeded: number; skipped: number; template: string }>(
        '/api/agents/team-templates',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            template_id: selectedTemplate.id,
          }),
        },
      );
      if (result.seeded === 0) {
        toast.info('All agents from this template already exist in your workspace.');
      } else {
        toast.success(
          `Added ${result.seeded} agent${result.seeded === 1 ? '' : 's'} from ${selectedTemplate.name}!`,
        );
      }
      onComplete();
    } catch {
      toast.error('Failed to generate team. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [selectedTemplate, workspaceId, onComplete]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[85vh] max-h-[720px] max-w-3xl flex-col overflow-hidden p-0">
        {selectedTemplate ? (
          <TemplateDetail
            template={selectedTemplate}
            onBack={() => setSelectedTemplate(null)}
            onGenerate={handleGenerate}
            generating={generating}
            userLeadAgent={userLeadAgent}
          />
        ) : (
          <>
            <DialogHeader className="border-border shrink-0 border-b px-6 pt-6 pb-4">
              <DialogTitle className="text-foreground text-lg font-medium">
                Team Templates
              </DialogTitle>
              <p className="text-foreground-lighter mt-0.5 text-sm">
                Choose a purpose-built agent team for your workspace.
                {data && (
                  <span className="text-foreground-lighter ml-1">
                    {data.stats.templates} templates, {data.stats.agents} agents
                  </span>
                )}
              </p>
            </DialogHeader>

            <div className="flex min-h-0 flex-1 flex-col">
              {/* Search + Category filter */}
              <div className="border-border flex shrink-0 items-center gap-3 border-b px-6 py-3">
                <div className="relative flex-1">
                  <Search className="text-foreground-lighter absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search templates..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-surface-100 border-border text-foreground placeholder:text-foreground-lighter focus:border-brand w-full rounded-md border py-2 pr-3 pl-9 text-sm outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-foreground-lighter hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category tabs */}
              <div className="border-border flex shrink-0 gap-1 overflow-x-auto border-b px-6 py-2">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-brand/10 text-brand'
                      : 'text-foreground-lighter hover:text-foreground hover:bg-surface-100'
                  }`}
                >
                  All
                </button>
                {data &&
                  Object.entries(data.categories).map(([key, val]) => {
                    const Icon = CATEGORY_ICONS[key as TeamCategory] ?? Bot;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedCategory(key as TeamCategory)}
                        className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          selectedCategory === key
                            ? 'bg-brand/10 text-brand'
                            : 'text-foreground-lighter hover:text-foreground hover:bg-surface-100'
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        {val.label}
                      </button>
                    );
                  })}
              </div>

              {/* Template grid */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="text-foreground-lighter h-5 w-5 animate-spin" />
                  </div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="text-foreground-lighter py-12 text-center text-sm">
                    No templates found.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredTemplates.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        onSelect={setSelectedTemplate}
                        userLeadAgent={userLeadAgent}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
