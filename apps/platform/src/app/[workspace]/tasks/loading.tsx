import { Skeleton } from '@repo/ui/components/skeleton';

export default function TasksLoading() {
  return (
    <div className="space-y-6 p-6">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      {/* Board columns */}
      <div className="flex gap-4 overflow-x-auto">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="min-w-[280px] space-y-3">
            <Skeleton className="h-8 w-32" />
            {Array.from({ length: 3 }).map((_, row) => (
              <Skeleton key={row} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
