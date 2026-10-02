import { Suspense } from 'react';
import { createClient } from '@repo/db/server';
import { computeOverviewMetrics } from '@/lib/analytics/overview';
import nextDynamic from 'next/dynamic';
import type { OverviewInitialData } from './_components/overview-dashboard';

const OverviewDashboard = nextDynamic(() => import('./_components/overview-dashboard'));

export const dynamic = 'force-dynamic';

async function getOverviewData(workspaceId: string): Promise<OverviewInitialData['overview']> {
  try {
    const supabase = await createClient();

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, status, completed_at, due_date')
      .eq('workspace_id', workspaceId)
      .neq('status', 'archived');

    if (error || !tasks) return null;

    return computeOverviewMetrics(tasks);
  } catch {
    return null;
  }
}

/** Resolve workspace slug to workspace ID */
async function resolveWorkspaceId(slug: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    // Try slug first, fall back to ID match
    const { data } = await supabase.from('workspaces').select('id').eq('slug', slug).maybeSingle();
    if (data) return data.id;
    // Slug didn't match — try as UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(slug)) return null;
    const { data: byId } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', slug)
      .maybeSingle();
    return byId?.id ?? null;
  } catch {
    return null;
  }
}

async function OverviewContent({ slug }: { slug: string }) {
  // "main" workspace aggregates all — skip server-side fetch, let client handle
  if (slug === 'main') {
    return <OverviewDashboard />;
  }

  const workspaceId = await resolveWorkspaceId(slug);
  if (!workspaceId) {
    return <OverviewDashboard />;
  }

  const overview = await getOverviewData(workspaceId);
  return <OverviewDashboard initialData={{ overview }} />;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-100 border-border h-[120px] animate-pulse rounded-lg border"
          />
        ))}
      </div>
      <div className="bg-surface-100 border-border h-[80px] animate-pulse rounded-lg border" />
      <div className="bg-surface-100 border-border h-[300px] animate-pulse rounded-lg border" />
    </div>
  );
}

export default async function OverviewPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;

  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewContent slug={workspace} />
    </Suspense>
  );
}
