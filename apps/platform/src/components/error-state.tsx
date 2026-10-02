'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@repo/ui/components/button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  message = 'Something went wrong. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="bg-destructive/10 flex h-12 w-12 items-center justify-center rounded-full">
        <AlertCircle className="text-destructive h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-foreground text-sm font-medium">Failed to load</p>
        <p className="text-muted-foreground max-w-xs text-xs">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="md" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  );
}
