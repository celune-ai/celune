'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@repo/ui/components/button';

export function ReconnectBanner({ onReconnect }: { onReconnect: () => Promise<boolean> }) {
  const [pending, setPending] = useState(false);
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-(--celune-border) bg-(--celune-surface) px-4 py-2 text-sm text-(--celune-fg)"
    >
      <span>Your session expired. Changes are paused until you reconnect.</span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await onReconnect();
          setPending(false);
        }}
      >
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Reconnect
      </Button>
    </div>
  );
}
