'use client';

import { useState, useEffect } from 'react';
import { Monitor, X } from 'lucide-react';

const STORAGE_KEY = 'celune-windows-notice-dismissed';

function detectWindows(): boolean {
  // Modern API first (Chromium 93+)
  if ('userAgentData' in navigator) {
    const uad = navigator as Navigator & { userAgentData?: { platform?: string } };
    if (uad.userAgentData?.platform) {
      return uad.userAgentData.platform.toLowerCase() === 'windows';
    }
  }
  // Fallback to userAgent string (works everywhere)
  return /win/i.test(navigator.userAgent);
}

export function WindowsNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (detectWindows() && !dismissed) {
      setShow(true);
    }
  }, []);

  function dismiss() {
    setShow(false);
    localStorage.setItem(STORAGE_KEY, '1');
  }

  if (!show) return null;

  return (
    <div className="bg-surface-100 border-border fixed right-2 bottom-2 z-50 flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg sm:right-4 sm:bottom-4">
      <Monitor className="text-foreground-muted mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">Optimized for Mac</p>
        <p className="text-foreground-muted mt-0.5 text-xs leading-relaxed">
          Some features may behave differently on Windows. We are actively working on full
          cross-platform support.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-foreground-muted hover:text-foreground shrink-0 rounded p-0.5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
