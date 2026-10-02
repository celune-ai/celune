import { Skeleton } from '@repo/ui/components/skeleton';

/**
 * Skeleton loader shown while the auth form is suspended (e.g., during SSR hydration).
 * Mirrors the visual structure of the login/signup form so the layout shift is minimal.
 */
export function AuthFormSkeleton() {
  return (
    <div className="w-full max-w-sm space-y-6" aria-busy="true" aria-label="Loading form">
      {/* Title + subtitle */}
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-7 w-40" />
        <Skeleton className="mx-auto h-4 w-28" />
      </div>

      {/* OAuth buttons */}
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-px flex-1" />
        <Skeleton className="h-4 w-6" />
        <Skeleton className="h-px flex-1" />
      </div>

      {/* Email button */}
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
