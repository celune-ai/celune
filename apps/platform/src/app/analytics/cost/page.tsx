import { Suspense } from 'react';
import nextDynamic from 'next/dynamic';

const CostDashboard = nextDynamic(() => import('./_components/cost-dashboard'));

function CostSkeleton() {
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
      <div className="bg-surface-100 border-border h-[300px] animate-pulse rounded-lg border" />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-100 border-border h-[250px] animate-pulse rounded-lg border"
          />
        ))}
      </div>
    </div>
  );
}

export default function CostPage() {
  return (
    <Suspense fallback={<CostSkeleton />}>
      <CostDashboard />
    </Suspense>
  );
}
