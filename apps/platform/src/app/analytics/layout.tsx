'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageActionBar } from '@/components/page-action-bar';
import { PageTabs } from '@/components/page-tabs';
import type { PageTab } from '@/components/page-tabs';
import { useWorkspace } from '@/providers/workspace-provider';
import { ActionBarProvider, useActionBarContent } from './action-bar-context';
import { AnalyticsZeroState } from '@/components/analytics/analytics-zero-state';

const TABS: (PageTab & { href: string })[] = [
  { id: 'overview', label: 'Overview', href: '/analytics/overview' },
  { id: 'cost', label: 'Cost', href: '/analytics/cost' },
  { id: 'agents', label: 'Agents', href: '/analytics/agents' },
];

function activeTab(pathname: string): string {
  if (pathname.includes('/analytics/cost')) return 'cost';
  if (pathname.includes('/analytics/agents')) return 'agents';
  return 'overview';
}

function AnalyticsActionBar() {
  const { content } = useActionBarContent();
  return (
    <PageActionBar>
      <span className="text-foreground text-xl font-medium">Analytics</span>
      <div className="flex items-center gap-2">{content}</div>
    </PageActionBar>
  );
}

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();

  // Redirect bare /analytics to /analytics/overview
  useEffect(() => {
    const bare = pathname === '/analytics' || pathname === '/app/analytics';
    if (bare) {
      router.replace('/analytics/overview');
    }
  }, [pathname, router]);

  const current = activeTab(pathname);

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
          tabs={TABS}
          active={current}
          onChange={(id) => {
            const tab = TABS.find((t) => t.id === id);
            if (tab) router.push(tab.href);
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
