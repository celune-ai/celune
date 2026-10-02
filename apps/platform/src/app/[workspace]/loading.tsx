import { Skeleton } from '@repo/ui/components/skeleton';

export default function WorkspaceLoading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar placeholder */}
      <div className="border-border bg-card hidden w-60 border-r md:block">
        <div className="space-y-4 p-4">
          <Skeleton className="h-8 w-32" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </div>
      {/* Main content placeholder */}
      <div className="flex-1 space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
