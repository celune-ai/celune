'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageActionBar } from '@/components/page-action-bar';
import { PageTabs } from '@/components/page-tabs';
import type { PageTab } from '@/components/page-tabs';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { useWorkspace } from '@/providers/workspace-provider';
import { ActionBarProvider, useActionBarContent } from './action-bar-context';
import { AnalyticsZeroState } from '@/components/analytics/analytics-zero-state';

const TAB_PATHS: (PageTab & { path: string })[] = [
  { id: 'overview', label: 'Overview', path: '/analytics/overview' },
  { id: 'cost', label: 'Cost', path: '/analytics/cost' },
  { id: 'agents', label: 'Agents', path: '/analytics/agents' },
];

function activeTab(pathname: string): string {
  if (pathname.includes('/analytics/cost')) return 'cost';
  if (pathname.includes('/analytics/agents')) return 'agents';
  return 'overview';
}

function AnalyticsActionBar() {
  const { content, badge } = useActionBarContent();
  const { isMainWorkspace } = useWorkspace();
  return (
    <PageActionBar>
      <div className="flex items-center gap-2">
        <span className="text-foreground text-xl font-medium">Analytics</span>
        {badge}
        {isMainWorkspace && (
          <span className="bg-brand/10 text-brand rounded-full px-2 py-0.5 text-xs font-medium">
            All workspaces
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">{content}</div>
    </PageActionBar>
  );
}

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { workspaceHref } = useWorkspaceHref();
  const { activeWorkspace } = useWorkspace();

  // Redirect bare /[workspace]/analytics to /[workspace]/analytics/overview
  useEffect(() => {
    const bare = pathname.endsWith('/analytics') || pathname.endsWith('/analytics/');
    if (bare) {
      router.replace(workspaceHref('/analytics/overview'));
    }
  }, [pathname, router, workspaceHref]);

  const current = activeTab(pathname);

  const tabs = TAB_PATHS.map((t) => ({
    ...t,
    href: workspaceHref(t.path),
  }));

  // Check if workspace is < 7 days old — show zero state
  const zeroState = useMemo(() => {
    if (!activeWorkspace?.created_at) return null;
    const created = new Date(activeWorkspace.created_at);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (daysSince >= 7) return null;
    const availableDate = new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      daysSinceCreation: daysSince,
      availableDate: availableDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  }, [activeWorkspace?.created_at]);

  return (
    <ActionBarProvider>
      <div className="flex min-h-full flex-col">
        <AnalyticsActionBar />
        <PageTabs
          tabs={tabs}
          active={current}
          onChange={(id) => {
            const tab = TAB_PATHS.find((t) => t.id === id);
            if (tab) router.push(workspaceHref(tab.path));
          }}
        />
        {zeroState ? (
          <AnalyticsZeroState
            daysSinceCreation={zeroState.daysSinceCreation}
            availableDate={zeroState.availableDate}
          />
        ) : (
          children
        )}
      </div>
    </ActionBarProvider>
  );
}
