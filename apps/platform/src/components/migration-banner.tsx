'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface MigrationStatusContextValue {
  detected: boolean;
  dismissed: boolean;
  reportMigrationIssue: () => void;
  dismiss: () => void;
}

const MigrationStatusContext = createContext<MigrationStatusContextValue>({
  detected: false,
  dismissed: false,
  reportMigrationIssue: () => {},
  dismiss: () => {},
});

export function useMigrationStatus() {
  return useContext(MigrationStatusContext);
}

/** Wrap the app with this provider to enable migration error detection. */
export function MigrationStatusProvider({ children }: { children: ReactNode }) {
  const [detected, setDetected] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const reportMigrationIssue = useCallback(() => setDetected(true), []);
  const dismiss = useCallback(() => setDismissed(true), []);

  return (
    <MigrationStatusContext.Provider value={{ detected, dismissed, reportMigrationIssue, dismiss }}>
      {children}
    </MigrationStatusContext.Provider>
  );
}

/** Render this inside the layout to show the banner when a migration error is detected. */
export function MigrationBanner() {
  const { detected, dismissed, dismiss } = useMigrationStatus();

  if (!detected || dismissed) return null;

  return (
    <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        Database migration may be pending — some features may not work correctly.
      </span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 hover:text-amber-300"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
