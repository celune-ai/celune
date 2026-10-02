'use client';

import type { AnchorHTMLAttributes } from 'react';
import { ExternalLink } from 'lucide-react';

export function MarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group/link inline-flex items-baseline gap-0"
      onClick={(e) => e.stopPropagation()}
      {...props}
    >
      <span className="max-w-[200px] truncate transition-[max-width] duration-200 group-hover/link:max-w-[180px] sm:max-w-none sm:group-hover/link:max-w-[calc(100%-1rem)]">
        {children}
      </span>
      <ExternalLink className="ml-0.5 inline-block h-3 w-3 shrink-0 translate-y-[-1px] opacity-0 transition-opacity duration-200 group-hover/link:opacity-70" />
    </a>
  );
}
