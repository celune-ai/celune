'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavLink {
  href: string;
  label: string;
}

interface NavProps {
  links: NavLink[];
  brand?: React.ReactNode;
}

export function Nav({ links, brand }: NavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="border-border bg-dash-sidebar/80 fixed top-0 z-50 w-full border-b backdrop-blur-sm"
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          {brand ?? 'Celune'}
        </Link>
        <div className="flex gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={
                link.href === '/'
                  ? pathname === '/'
                    ? 'page'
                    : undefined
                  : pathname.startsWith(link.href)
                    ? 'page'
                    : undefined
              }
              className={`text-sm transition-colors ${
                (link.href === '/' ? pathname === '/' : pathname.startsWith(link.href))
                  ? 'text-foreground'
                  : 'text-foreground-lighter hover:text-foreground'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
