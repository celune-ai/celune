'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Terminal, Zap } from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';
import { cn } from '@repo/ui/utils';
import type { SkillCatalogEntry } from '@/lib/skill-catalog';
import { TRIGGER_META, CATEGORY_META } from '@/lib/skill-catalog';

interface SkillDetailDrawerProps {
  open: boolean;
  skill: SkillCatalogEntry | null;
  onClose: () => void;
}

export function SkillDetailDrawer({ open, skill, onClose }: SkillDetailDrawerProps) {
  // Cache the last non-null skill so the exit animation shows content
  const cachedSkill = useRef<SkillCatalogEntry | null>(null);
  if (skill) cachedSkill.current = skill;
  const displaySkill = skill ?? cachedSkill.current;

  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus management: trap focus on open, restore on close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // Focus the close button inside the drawer after render
      requestAnimationFrame(() => {
        const closeBtn = drawerRef.current?.querySelector<HTMLElement>(
          '[aria-label="Close skill drawer"]',
        );
        closeBtn?.focus();
      });
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // Trap focus within the drawer when open
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!displaySkill) return null;

  const Icon = displaySkill.icon;
  const triggerMeta = TRIGGER_META[displaySkill.trigger];
  const categoryMeta = CATEGORY_META[displaySkill.category];

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[100] bg-black/60 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close drawer"
      />

      {/* Drawer */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={drawerRef}
        className={cn(
          'bg-surface-75 border-border fixed inset-y-0 right-0 z-[101] flex w-full max-w-md flex-col border-l shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={`${displaySkill.title} details`}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="border-border flex items-start gap-3 border-b px-6 py-5">
          <div className="bg-surface-200 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
            <Icon className="text-foreground h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-foreground text-lg font-bold">
              {displaySkill.trigger === 'slash' ? displaySkill.command : displaySkill.title}
            </h2>
            <p className="text-foreground-lighter mt-0.5 text-sm">{displaySkill.description}</p>
          </div>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-foreground-lighter hover:text-foreground focus-visible:ring-brand shrink-0 rounded-md p-1 transition-colors focus-visible:ring-1 focus-visible:outline-none"
                  aria-label="Close skill drawer"
                >
                  <X className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                displaySkill.trigger === 'slash'
                  ? 'emerald-dark'
                  : displaySkill.trigger === 'auto'
                    ? 'gold-dark'
                    : 'violet-dark'
              }
            >
              {triggerMeta.label}
            </Badge>
            <Badge variant="blue">{categoryMeta.label}</Badge>
            {displaySkill.integration && (
              <Badge variant="outline">
                <Zap className="mr-1 h-3 w-3" />
                Requires {displaySkill.integration}
              </Badge>
            )}
          </div>

          {/* Details */}
          <section>
            <h3 className="text-foreground mb-2 text-sm font-semibold">About</h3>
            <p className="text-foreground-lighter text-sm leading-relaxed">
              {displaySkill.details}
            </p>
          </section>

          {/* How it works */}
          <section>
            <h3 className="text-foreground mb-2 text-sm font-semibold">How it works</h3>
            <p className="text-foreground-lighter text-sm leading-relaxed">
              {triggerMeta.description}
            </p>
          </section>

          {/* Example usage */}
          {displaySkill.example && (
            <section>
              <h3 className="text-foreground mb-2 text-sm font-semibold">Example</h3>
              <div className="bg-surface-200 border-border flex items-center gap-2 rounded-lg border px-4 py-3">
                <Terminal className="text-foreground-lighter h-4 w-4 shrink-0" />
                <code className="text-foreground font-mono text-sm">{displaySkill.example}</code>
              </div>
            </section>
          )}

          {/* Manifest path */}
          <section>
            <h3 className="text-foreground mb-2 text-sm font-semibold">Source</h3>
            <p className="text-foreground-muted font-mono text-xs">
              .claude/{displaySkill.manifestPath}
            </p>
          </section>
        </div>
      </div>
    </>,
    document.body,
  );
}
