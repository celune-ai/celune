'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Info,
  Key,
  Rocket,
  CreditCard,
  GitBranch,
  UserCheck,
} from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';
import { Button } from '@repo/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@repo/ui/components/tooltip';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import Link from 'next/link';

interface GateResult {
  status: 'pass' | 'fail';
  detail: string;
}

interface ReadinessResponse {
  gates: Record<string, GateResult>;
  ready: boolean;
}

/** Map gate keys to display metadata */
const GATE_META: Record<
  string,
  { label: string; subtitle: string; icon: typeof AlertTriangle; href: string }
> = {
  api_keys: {
    label: 'API keys not configured',
    subtitle: 'Add provider API keys to enable AI features.',
    icon: Key,
    href: '/settings?tab=integrations',
  },
  onboarding: {
    label: 'Workspace setup incomplete',
    subtitle: 'Complete your workspace setup to unlock all features.',
    icon: Rocket,
    href: '/settings',
  },
  plan: {
    label: 'No active plan',
    subtitle: 'Subscribe to a plan to access full functionality.',
    icon: CreditCard,
    href: '/settings?tab=billing',
  },
  workspace: {
    label: 'Repository not connected',
    subtitle: 'Connect a GitHub repository to enable code features.',
    icon: GitBranch,
    href: '/settings?tab=integrations',
  },
  account: {
    label: 'Account not verified',
    subtitle: 'Verify your account to access workspace features.',
    icon: UserCheck,
    href: '/settings?tab=members',
  },
};

/**
 * Full-width alert banner shown above the side nav when any workspace
 * readiness gate fails. Cannot be dismissed until all issues are resolved.
 */
export function WorkspaceReadinessBanner() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const workspaceId = activeWorkspace?.id;

  const [gates, setGates] = useState<Record<string, GateResult> | null>(null);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;
    setLoading(true);

    fetchJson<ReadinessResponse>(apiUrl(`/api/readiness?workspace_id=${workspaceId}`))
      .then((data) => {
        if (cancelled) return;
        setGates(data.gates);
        setReady(data.ready);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!issuesOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIssuesOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIssuesOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [issuesOpen]);

  if (loading || ready || !gates) return null;

  const failingGates = Object.entries(gates).filter(([, g]) => g.status === 'fail');
  if (failingGates.length === 0) return null;

  const [primaryKey] = failingGates[0];
  const meta = GATE_META[primaryKey];
  if (!meta) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="status"
        className="flex items-center gap-3 border-b border-[#FACC15]/30 bg-[#FACC15]/8 px-5 py-2.5"
      >
        {/* Warning icon */}
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#FACC15]" />

        {/* Left group: title + info icon + issues badge */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="text-foreground shrink-0 text-sm leading-tight font-medium">{meta.label}</p>

          {/* Info icon — hover shows subtitle */}
          {meta.subtitle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 shrink-0 cursor-help text-[#FACC15]/60" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px]">
                {meta.subtitle}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Issues count badge — click to show popover */}
          {failingGates.length > 1 && (
            <div ref={popoverRef} className="relative ml-2 shrink-0">
              <button
                type="button"
                className="cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  setIssuesOpen((o) => !o);
                }}
              >
                <Badge variant="gold" size="sm" className="flex items-center gap-0.5">
                  {failingGates.length} issues
                  <ChevronDown className="h-3 w-3 text-[#161616]" />
                </Badge>
              </button>

              {issuesOpen && (
                <div className="absolute top-full left-0 z-50 mt-1 min-w-[220px] rounded-md border border-[#383A3B] bg-[#1a1a1b] p-2.5 shadow-lg">
                  <div className="space-y-2.5">
                    {failingGates.map(([key]) => {
                      const gateMeta = GATE_META[key];
                      if (!gateMeta) return null;
                      const GateIcon = gateMeta.icon;
                      return (
                        <Link
                          key={key}
                          href={workspaceHref(gateMeta.href)}
                          className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-white hover:bg-white/10"
                          onClick={() => setIssuesOpen(false)}
                        >
                          <GateIcon className="h-3.5 w-3.5 shrink-0 text-[#FACC15]" />
                          <span>{gateMeta.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right group: Resolve button — dark yellow */}
        <div className="shrink-0">
          <Link href={workspaceHref(meta.href)}>
            <Button
              size="sm"
              className="cursor-pointer border border-[#FACC15]/40 bg-[#3d3000] text-xs font-semibold text-[#FACC15] hover:bg-[#4d3d00]"
            >
              Resolve
            </Button>
          </Link>
        </div>
      </div>
    </TooltipProvider>
  );
}
