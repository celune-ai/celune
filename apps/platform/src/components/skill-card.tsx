'use client';

import { Lock } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import type { SkillCatalogEntry } from '@/lib/skill-catalog';
import { TRIGGER_META } from '@/lib/skill-catalog';

const TIER_LABELS: Record<string, string> = {
  essential: 'Builder',
  standard: 'Pro',
  premium: 'Unlimited',
};

interface SkillCardProps {
  skill: SkillCatalogEntry;
  onClick: () => void;
  locked?: boolean;
}

export function SkillCard({ skill, onClick, locked }: SkillCardProps) {
  const Icon = skill.icon;
  const triggerMeta = TRIGGER_META[skill.trigger];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-surface-75 border-border hover:border-foreground-muted focus-visible:ring-brand/25 flex w-full cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-2 ${locked ? 'opacity-60' : ''}`}
    >
      {/* Icon */}
      <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        {locked ? (
          <Lock className="text-foreground-muted h-5 w-5" />
        ) : (
          <Icon className="text-foreground h-5 w-5" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-bold">
            {skill.trigger === 'slash' ? skill.command : skill.title}
          </span>
          {locked && (
            <Badge variant="outline" size="sm">
              {TIER_LABELS[skill.tier] ?? skill.tier}
            </Badge>
          )}
          {!locked && skill.integration && (
            <Badge variant="outline" size="sm">
              {skill.integration}
            </Badge>
          )}
        </div>
        <p className="text-foreground-lighter mt-1 line-clamp-2 text-xs leading-relaxed">
          {skill.description}
        </p>

        {/* Trigger badge */}
        <div className="mt-2.5">
          <Badge
            variant={
              skill.trigger === 'slash'
                ? 'emerald-dark'
                : skill.trigger === 'auto'
                  ? 'gold-dark'
                  : 'violet-dark'
            }
            size="sm"
          >
            {triggerMeta.label}
          </Badge>
        </div>
      </div>
    </button>
  );
}
