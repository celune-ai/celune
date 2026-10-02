'use client';

import { useDroppable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { cn } from '@repo/ui/utils';
import type { LucideIcon } from 'lucide-react';

export interface PageTab {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface PageTabsProps {
  tabs: PageTab[];
  active: string;
  onChange: (id: string) => void;
  /** When true, each tab becomes a drop target with id `tab:<tab.id>` */
  droppable?: boolean;
  /** When true, suppress onClick (set during drag to prevent tab switching on drop) */
  suppressClick?: boolean;
}

function DroppableTab({
  tab,
  active,
  onChange,
  suppressClick,
}: {
  tab: PageTab;
  active: string;
  onChange: (id: string) => void;
  suppressClick?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `tab:${tab.id}` });
  const Icon = tab.icon;

  return (
    <button
      ref={setNodeRef}
      key={tab.id}
      onClick={() => {
        if (suppressClick) return;
        onChange(tab.id);
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors',
        active === tab.id
          ? 'border-brand text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:border-border border-transparent',
        isOver && 'bg-brand/10 text-foreground rounded-lg border-transparent',
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {tab.label}
    </button>
  );
}

export function PageTabs({ tabs, active, onChange, droppable, suppressClick }: PageTabsProps) {
  return (
    <div className="border-border border-b px-6">
      <nav className="-mb-px flex gap-6" aria-label="Tabs">
        {tabs.map((tab) =>
          droppable ? (
            <DroppableTab
              key={tab.id}
              tab={tab}
              active={active}
              onChange={onChange}
              suppressClick={suppressClick}
            />
          ) : (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={cn(
                'relative flex cursor-pointer items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors',
                active === tab.id
                  ? 'text-foreground border-transparent'
                  : 'text-muted-foreground hover:text-foreground hover:border-border border-transparent',
              )}
            >
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
              {active === tab.id && (
                <motion.div
                  layoutId="page-tab-indicator"
                  className="bg-brand absolute right-0 bottom-0 left-0 h-0.5"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  style={{ borderRadius: 1 }}
                />
              )}
            </button>
          ),
        )}
      </nav>
    </div>
  );
}
