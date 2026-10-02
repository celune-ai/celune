import type { ReactNode } from 'react';

interface PageActionBarProps {
  children?: ReactNode;
  className?: string;
}

export function PageActionBar({ children, className }: PageActionBarProps) {
  return (
    <div
      className={[
        'border-border bg-surface-75 sticky top-0 z-10 flex h-14 w-full shrink-0 items-center justify-between border-b px-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
