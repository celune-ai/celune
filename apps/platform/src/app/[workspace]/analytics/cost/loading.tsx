import { Skeleton } from '@repo/ui/components/skeleton';

export default function CostAnalyticsLoading() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-lg" />
    </div>
  );
}
