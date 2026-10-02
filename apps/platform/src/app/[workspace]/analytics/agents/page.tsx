import { Suspense } from 'react';
import nextDynamic from 'next/dynamic';

const AgentsDashboard = nextDynamic(() => import('./_components/agents-dashboard'));

export const dynamic = 'force-dynamic';

function AgentsSkeleton() {
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
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-100 border-border h-[120px] animate-pulse rounded-lg border"
          />
        ))}
      </div>
      <div className="bg-surface-100 border-border h-[300px] animate-pulse rounded-lg border" />
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsSkeleton />}>
      <AgentsDashboard />
    </Suspense>
  );
}
