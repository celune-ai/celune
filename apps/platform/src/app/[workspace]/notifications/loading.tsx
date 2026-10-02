import { Skeleton } from '@repo/ui/components/skeleton';

export default function NotificationsLoading() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-8 w-52" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b p-3">
            <Skeleton className="h-4 w-4 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
