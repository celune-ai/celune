'use client';

import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import { cn } from '@repo/ui/utils';
import type { MarketplaceAgent } from '@repo/db/team-templates';
import { fetchJson } from '@/lib/fetch-json';
import { apiUrl } from '@repo/db/api';
import { toast } from 'sonner';

interface AgentDetailDrawerProps {
  open: boolean;
  agent: (MarketplaceAgent & { employed: boolean; is_active: boolean }) | null;
  onClose: () => void;
  onEmployed?: () => void;
  workspaceId?: string;
  canEmploy: boolean;
}

const PARAM_LABELS: Record<string, string> = {
  humor: 'Humor',
  honesty: 'Honesty',
  directness: 'Directness',
  warmth: 'Warmth',
  confidence: 'Confidence',
  formality: 'Formality',
  verbosity: 'Verbosity',
  autonomy: 'Autonomy',
};

export function AgentDetailDrawer({
  open,
  agent,
  onClose,
  onEmployed,
  workspaceId,
  canEmploy,
}: AgentDetailDrawerProps) {
  const [employing, setEmploying] = useState(false);
  const cachedAgent = useRef(agent);
  if (agent) cachedAgent.current = agent;
  const display = cachedAgent.current;

  // Keyboard: Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleEmploy = async () => {
    if (!display || !workspaceId) return;
    setEmploying(true);
    try {
      await fetchJson(apiUrl('/api/agents/marketplace'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, agent_id: display.agent_id }),
      });
      toast.success(`${display.display_name} has been added to your team`);
      onEmployed?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to employ agent';
      if (msg.includes('plan_limit')) {
        toast.error('Agent limit reached. Upgrade your plan for more agents.');
      } else if (msg.includes('already employed')) {
        toast.error(`${display.display_name} is already on your team.`);
      } else {
        toast.error(msg);
      }
    } finally {
      setEmploying(false);
    }
  };

  if (!display) return null;

  const params = display.parameters ?? {};

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
        aria-label={`Agent details: ${display.display_name}`}
        className={cn(
          'border-border bg-surface-75 fixed top-0 right-0 z-[61] flex h-full w-2/5 max-w-[500px] min-w-[380px] flex-col border-l shadow-2xl transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
              style={{ backgroundColor: display.color + '20', color: display.color }}
            >
              {display.display_name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-foreground text-base font-semibold">{display.display_name}</h2>
                {display.employed && <CheckCircle2 className="text-brand h-4 w-4" />}
              </div>
              <p className="text-foreground-lighter text-xs">{display.role}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-foreground-lighter hover:text-foreground rounded p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* About */}
          <section>
            <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
              About
            </h3>
            <p className="text-foreground text-sm leading-relaxed">{display.description}</p>
          </section>

          {/* Persona */}
          {display.persona_prompt && (
            <section>
              <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
                Persona
              </h3>
              <div className="bg-surface-100 border-border rounded-md border p-3">
                <p className="text-foreground-lighter text-xs leading-relaxed">
                  {display.persona_prompt}
                </p>
              </div>
            </section>
          )}

          {/* Parameters */}
          {Object.keys(params).length > 0 && (
            <section>
              <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
                Personality
              </h3>
              <div className="space-y-2">
                {Object.entries(params).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-foreground-lighter w-20 text-xs">
                      {PARAM_LABELS[key] ?? key}
                    </span>
                    <div className="bg-surface-300 h-1.5 flex-1 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${value}%`,
                          backgroundColor: display.color,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <span className="text-foreground-muted w-6 text-right text-[10px] tabular-nums">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Team context */}
          <section>
            <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
              Available in
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {display.appears_in.map((team) => (
                <Badge key={team} variant="outline" className="text-[10px]">
                  {team}
                </Badge>
              ))}
            </div>
          </section>

          {/* Model */}
          <section>
            <h3 className="text-foreground-lighter mb-2 text-xs font-medium tracking-wide uppercase">
              Model
            </h3>
            <Badge variant="outline" className="text-xs">
              <Sparkles className="mr-1 h-3 w-3" />
              {display.model === 'claude-sonnet-4-6' ? 'Claude Sonnet 4.6' : 'Claude Haiku 4.5'}
            </Badge>
          </section>
        </div>

        {/* Footer */}
        <div className="border-border border-t px-5 py-4">
          {display.employed ? (
            <p className="text-brand flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Already on your team
            </p>
          ) : canEmploy ? (
            <Button onClick={handleEmploy} disabled={employing} className="w-full">
              {employing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add to Team'
              )}
            </Button>
          ) : (
            <div className="text-center">
              <p className="text-foreground-lighter text-xs">Agent limit reached</p>
              <a
                href="/settings?tab=billing"
                className="text-brand text-xs underline underline-offset-2"
              >
                Upgrade plan for more agents
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
