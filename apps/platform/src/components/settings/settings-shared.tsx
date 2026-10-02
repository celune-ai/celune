'use client';

import { CircleHelp } from 'lucide-react';
import { Switch } from '@repo/ui/components/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';

/** Vercel-style settings card wrapper with animated footer */
export function SettingsCard({
  children,
  footer,
  danger,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="p-6">{children}</div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: footer ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div
            className={`flex items-center justify-between border-t px-6 py-3 ${
              danger ? 'border-destructive/20 bg-destructive/5' : 'border-border bg-surface-75'
            }`}
          >
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Toggle row for settings, matching Vercel's label + switch pattern */
export function SettingsToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="border-border flex items-center justify-between border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-sm">{label}</span>
        {description && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <CircleHelp size={14} className="text-foreground-muted" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                {description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-foreground-muted text-sm">{checked ? 'Enabled' : 'Disabled'}</span>
        <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      </div>
    </div>
  );
}

/** Format a GitHub repo URL into a short display name */
export function formatRepoUrl(url: string): string {
  // Try GitHub-style parsing
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (match) return match[1];
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return url;
  }
}

/** Format an ISO date into a relative "Connected X ago" string */
export function formatConnectedDate(iso: string): string {
  try {
    const now = new Date();
    const date = new Date(iso);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Connected just now';
    if (diffMins < 60) return `Connected ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Connected ${diffHours}h ago`;
    return `Connected ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } catch {
    return `Connected ${iso}`;
  }
}
