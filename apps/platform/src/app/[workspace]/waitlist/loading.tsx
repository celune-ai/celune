import { Skeleton } from '@repo/ui/components/skeleton';

export default function WaitlistLoading() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-48" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
