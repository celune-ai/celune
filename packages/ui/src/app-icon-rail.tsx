'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type LucideIcon } from 'lucide-react';
import { cn } from './utils';
import { TooltipProvider } from './components/tooltip';

/* Matches Supabase's ICON_SIZE / ICON_STROKE_WIDTH constants */
export const ICON_SIZE = 20;
export const ICON_STROKE_WIDTH = 1.5;

export interface IconRailItem {
  icon: LucideIcon;
  href: string;
  label: string;
  external?: boolean;
  dividerBefore?: boolean;
}

interface AppIconRailProps {
  items: IconRailItem[];
  bottomItems?: IconRailItem[];
  bottomAction?: React.ReactNode;
  /** Rendered between bottom items and footer (e.g. branch indicator) */
  statusSlot?: React.ReactNode;
  /** Rendered below the bottom items, separated by a divider */
  footerSlot?: React.ReactNode;
  logo?: React.ReactNode;
  /** Rendered inline next to the logo in the header row */
  logoAction?: React.ReactNode;
  headerSlot?: React.ReactNode;
  className?: string;
}

/* ----------------------------------------------------------------
   Single nav item — icon + label
   ---------------------------------------------------------------- */
function RailIcon({ item, active }: { item: IconRailItem; active: boolean }) {
  const Icon = item.icon;
  const classes = cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    active
      ? 'bg-selection text-foreground shadow-sm'
      : 'text-foreground-lighter hover:bg-surface-200 hover:text-foreground',
  );
  const children = (
    <>
      <Icon
        size={ICON_SIZE}
        strokeWidth={active ? ICON_STROKE_WIDTH : 1}
        className="shrink-0"
        aria-hidden="true"
      />
      <span className="truncate">{item.label}</span>
    </>
  );

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={item.label}
        className={classes}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={classes}
    >
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------
   AppIconRail — always-visible icon + label sidebar
   ---------------------------------------------------------------- */
export function AppIconRail({
  items,
  bottomItems,
  bottomAction,
  statusSlot,
  footerSlot,
  logo,
  logoAction,
  headerSlot,
  className,
}: AppIconRailProps) {
  const pathname = usePathname();

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'border-border bg-surface-75 flex h-full w-full flex-col border-r',
          className,
        )}
      >
        {/* Logo + optional inline action (e.g. workspace switcher) */}
        {logo && (
          <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b pr-2 pl-4">
            <div className="shrink-0">{logo}</div>
            {logoAction && <div className="min-w-0 flex-1">{logoAction}</div>}
          </div>
        )}

        {/* Optional header slot (e.g. workspace switcher) */}
        {headerSlot}

        {/* Primary nav */}
        <nav className="flex flex-1 flex-col gap-0.5 px-2 pt-4 pb-3" aria-label="Main navigation">
          {items.map((item) => (
            <React.Fragment key={item.href}>
              {item.dividerBefore && (
                <div className="border-border my-[16px] border-t" role="separator" />
              )}
              <RailIcon item={item} active={isActive(item.href)} />
            </React.Fragment>
          ))}
        </nav>

        {/* Bottom nav */}
        {(bottomAction || (bottomItems && bottomItems.length > 0)) && (
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {bottomAction}
            {bottomItems?.map((item) => (
              <RailIcon key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
        )}

        {/* Status slot (branch indicator, etc.) */}
        {statusSlot && <div className="border-border border-t px-2 py-2">{statusSlot}</div>}

        {/* Footer slot (user profile, etc.) */}
        {footerSlot && <div className="border-border border-t px-2 py-3">{footerSlot}</div>}
      </div>
    </TooltipProvider>
  );
}
