import { Suspense } from 'react';
import nextDynamic from 'next/dynamic';

const OverviewDashboard = nextDynamic(() => import('./_components/overview-dashboard'));

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

export default function OverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewDashboard />
    </Suspense>
  );
}
