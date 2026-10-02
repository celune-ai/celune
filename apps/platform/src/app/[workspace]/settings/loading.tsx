import { Skeleton } from '@repo/ui/components/skeleton';

export default function SettingsLoading() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-48" />
      {/* Tab bar */}
      <Skeleton className="h-10 w-full max-w-2xl" />
      {/* Settings form */}
      <div className="max-w-2xl space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}
