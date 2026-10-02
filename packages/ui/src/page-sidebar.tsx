'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from './utils';

export interface PageSidebarItem {
  label: string;
  href: string;
  badge?: string;
  badgeVariant?: 'new' | 'beta' | 'default';
  external?: boolean;
}

export interface PageSidebarSection {
  title?: string;
  items: PageSidebarItem[];
}

interface BadgeProps {
  text: string;
  variant?: 'new' | 'beta' | 'default';
}

function SidebarBadge({ text, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={cn(
        'ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase',
        variant === 'new' && 'bg-brand-500 text-brand-600',
        variant === 'beta' && 'bg-surface-400 text-foreground-muted',
        variant === 'default' && 'bg-surface-300 text-foreground-lighter',
      )}
    >
      {text}
    </span>
  );
}

export interface PageSidebarProps {
  title: string;
  sections: PageSidebarSection[];
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

export function PageSidebar({
  title,
  sections,
  collapsible = false,
  collapsed = false,
  onCollapsedChange,
  className,
}: PageSidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div
      className={cn(
        'border-border bg-surface-75 flex h-full flex-col border-r transition-[width] duration-200',
        collapsed ? 'w-0 overflow-hidden border-none' : 'w-64',
        className,
      )}
    >
      {/* Header: section title + collapse toggle */}
      <div className="border-border flex h-12 shrink-0 items-center justify-between border-b px-5">
        <span className="text-foreground text-sm font-medium">{title}</span>
        {collapsible && (
          <button
            type="button"
            onClick={() => onCollapsedChange?.(!collapsed)}
            className="text-foreground-muted hover:bg-surface-200 hover:text-foreground flex h-6 w-6 items-center justify-center rounded"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* Nav sections */}
      <div className="flex-1 overflow-y-auto py-3">
        {sections.map((section, i) => (
          <div key={i} className={i > 0 ? 'mt-2' : ''}>
            {section.title && (
              <p
                className="mb-1 px-5 pt-3 pb-1 text-[12px] font-medium tracking-[0.08em] uppercase"
                style={{ color: 'hsl(0deg 0.2% 62.09%)' }}
              >
                {section.title}
              </p>
            )}
            <ul className="space-y-px px-3">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href} className="relative">
                    {active && (
                      <motion.div
                        layoutId="sidebar-active-indicator"
                        className="bg-surface-200 absolute inset-0 rounded-md"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        style={{ borderRadius: 6 }}
                      />
                    )}
                    <Link
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'text-foreground'
                          : 'text-foreground-lighter hover:bg-surface-100 hover:text-foreground',
                      )}
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && <SidebarBadge text={item.badge} variant={item.badgeVariant} />}
                      {item.external && (
                        <ExternalLink
                          size={12}
                          className="text-foreground-muted shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
   Collapsed hint — a small bar shown when sidebar is collapsed,
   with a toggle button to re-expand.
   ---------------------------------------------------------------- */
interface CollapsedHintProps {
  onExpand: () => void;
}

export function PageSidebarCollapsedHint({ onExpand }: CollapsedHintProps) {
  return (
    <div className="border-border flex h-full w-6 shrink-0 items-start border-r pt-3">
      <button
        type="button"
        onClick={onExpand}
        className="text-foreground-muted hover:text-foreground flex h-10 w-6 items-center justify-center"
        aria-label="Expand sidebar"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
