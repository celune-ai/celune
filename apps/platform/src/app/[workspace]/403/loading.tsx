import { Skeleton } from '@repo/ui/components/skeleton';

export default function ForbiddenLoading() {
  return (
    <div className="flex items-center justify-center p-12">
      <Skeleton className="h-32 w-64 rounded-lg" />
    </div>
  );
}
