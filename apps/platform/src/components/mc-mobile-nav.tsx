'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mcNav } from '@/lib/nav';

export function McMobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex items-center gap-2 rounded-md px-3 py-1.5 text-sm lg:hidden"
        aria-label="Open navigation menu"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
        Menu
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      <div
        className={`border-border bg-alternative fixed inset-y-0 left-0 z-50 w-72 transform border-r transition-transform duration-200 ease-out lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-border flex h-14 items-center justify-between border-b px-4">
          <span className="text-foreground text-sm font-semibold">Celune</span>
          <button
            type="button"
            onClick={close}
            className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground rounded-md p-1.5"
            aria-label="Close navigation menu"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <nav aria-label="Celune" className="space-y-1 overflow-y-auto p-4">
          {mcNav.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-surface-300 text-foreground font-medium'
                    : 'text-foreground-lighter hover:bg-surface-200 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.title}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
