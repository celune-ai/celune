'use client';

import Link from 'next/link';
import { cn } from '@repo/ui/utils';

interface BracketLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  external?: boolean;
}

/**
 * A link component with bracket hover effect inspired by maximeheckel.com.
 * On hover, brackets [ ] appear around the link text with a smooth animation.
 */
export function BracketLink({ href, children, className, external }: BracketLinkProps) {
  const linkClass = cn(
    'bracket-link relative inline-flex items-center text-brand hover:text-brand-dark transition-colors',
    className,
  );

  const content = (
    <>
      <span
        aria-hidden="true"
        className="bracket-left mr-0 inline-block translate-x-1 opacity-0 transition-all duration-200"
      >
        [
      </span>
      <span>{children}</span>
      <span
        aria-hidden="true"
        className="bracket-right ml-0 inline-block -translate-x-1 opacity-0 transition-all duration-200"
      >
        ]
      </span>
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={linkClass}>
      {content}
    </Link>
  );
}
