import { Loader2 } from 'lucide-react';

export default function MemoryLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="text-foreground-lighter h-6 w-6 animate-spin" />
    </div>
  );
}
