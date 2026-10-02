'use client';

import Image from 'next/image';
import { Badge } from '@repo/ui/components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui/components/tooltip';
import { CheckCircle2, Lock } from 'lucide-react';
import type { MarketplaceAgent } from '@repo/db/team-templates';

interface AgentMarketplaceCardProps {
  agent: MarketplaceAgent & { employed: boolean; is_active: boolean };
  onClick: () => void;
  locked: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  software: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  marketing: 'bg-green-500/10 text-green-400 border-green-500/20',
  content: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  business: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  creative: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  operations: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'professional-services': 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  personal: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

export function AgentMarketplaceCard({ agent, onClick, locked }: AgentMarketplaceCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={locked && !agent.employed ? true : undefined}
      className="border-border bg-surface-75 hover:border-border-strong group relative flex flex-col items-start gap-3 rounded-lg border p-4 text-left transition-colors"
    >
      {/* Locked overlay */}
      {locked && !agent.employed && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/40"
          aria-label="Upgrade plan to employ this agent"
        >
          <Lock className="h-5 w-5 text-white/60" />
        </div>
      )}

      {/* Header: avatar + name */}
      <div className="flex w-full items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{ backgroundColor: agent.color + '20', color: agent.color }}
        >
          {agent.display_name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">
              {agent.display_name}
            </span>
            {agent.employed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <CheckCircle2 className="text-brand h-3.5 w-3.5 shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  On your team
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <span className="text-foreground-lighter text-xs">{agent.role}</span>
        </div>
      </div>

      {/* Description */}
      <p className="text-foreground-lighter line-clamp-2 text-xs leading-relaxed">
        {agent.description}
      </p>

      {/* Footer: category badge + model */}
      <div className="flex w-full items-center gap-2">
        <Badge
          variant="outline"
          className={`px-1.5 py-0 text-[10px] ${CATEGORY_COLORS[agent.category] ?? ''}`}
        >
          {agent.team_name}
        </Badge>
        <span className="text-foreground-muted text-[10px]">
          {agent.model === 'claude-sonnet-4-6' ? 'Sonnet' : 'Haiku'}
        </span>
      </div>
    </button>
  );
}
