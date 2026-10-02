'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import {
  ChevronDown,
  Search,
  BookOpen,
  MessageSquare,
  Key,
  Bot,
  CreditCard,
  Plug,
  AlertTriangle,
  ExternalLink,
  ArrowLeft,
  LifeBuoy,
} from 'lucide-react';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { DOMAIN_DOCS, URL_DOCS } from '@/lib/branding';
import { FAQ_CATEGORIES, type FaqItem, type FaqCategory } from '@/lib/faq-data';

/** Map category IDs to Lucide icons for the help page UI */
const CATEGORY_ICONS: Record<string, typeof BookOpen> = {
  account: Key,
  agents: Bot,
  'api-keys': Key,
  billing: CreditCard,
  integrations: Plug,
  troubleshooting: AlertTriangle,
};

type FaqCategoryWithIcon = FaqCategory & { icon: typeof BookOpen };

/** Enrich shared FAQ data with icons for rendering */
const FAQ_WITH_ICONS: FaqCategoryWithIcon[] = FAQ_CATEGORIES.map((cat) => ({
  ...cat,
  icon: CATEGORY_ICONS[cat.id] ?? BookOpen,
}));

function FaqItemRow({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-border border-b last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="hover:bg-surface-100 flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors"
        aria-expanded={open}
      >
        <span className="text-foreground text-sm leading-snug font-medium">{item.q}</span>
        <ChevronDown
          className={[
            'text-foreground-lighter mt-0.5 h-4 w-4 shrink-0 transition-transform',
            open ? 'rotate-180' : '',
          ].join(' ')}
        />
      </button>
      {open && (
        <div className="bg-surface-75 px-4 pb-4">
          <p className="text-foreground-lighter text-sm leading-relaxed">{item.a}</p>
          {item.docsHref && (
            <a
              href={item.docsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand mt-3 inline-flex items-center gap-1 text-xs hover:underline"
            >
              {item.docsLabel ?? 'Learn more'}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function HelpCenterPage() {
  const { workspaceHref } = useWorkspaceHref();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q && !activeCategory) return FAQ_WITH_ICONS;

    return FAQ_WITH_ICONS.filter((cat) => {
      if (activeCategory && cat.id !== activeCategory) return false;
      if (!q) return true;
      const matchesCategory = cat.label.toLowerCase().includes(q);
      const matchesItem = cat.items.some(
        (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
      );
      return matchesCategory || matchesItem;
    })
      .map((cat) => {
        if (!q) return cat;
        return {
          ...cat,
          items: cat.items.filter(
            (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
          ),
        };
      })
      .filter((cat) => cat.items.length > 0);
  }, [query, activeCategory]);

  const totalResults = filtered.reduce((sum, cat) => sum + cat.items.length, 0);

  return (
    <div className="flex min-h-screen flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={workspaceHref('/support')}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Support
            </Link>
          </Button>
          <span className="text-foreground-muted text-xs">/</span>
          <h1 className="text-foreground text-sm font-medium">Help Center</h1>
        </div>
        <Button variant="default" size="sm" asChild>
          <Link href={workspaceHref('/support')}>
            <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
            Contact Support
          </Link>
        </Button>
      </PageActionBar>

      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <h2 className="text-foreground mb-2 text-2xl font-semibold tracking-tight">
            How can we help?
          </h2>
          <p className="text-foreground-lighter mb-6 text-sm">
            Browse common questions or search for what you need.
          </p>

          {/* Search */}
          <div className="relative mx-auto max-w-md">
            <Search className="text-foreground-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search FAQ…"
              className="border-border-control bg-surface-75 text-foreground placeholder:text-foreground-muted focus:border-brand focus:ring-brand/20 w-full rounded-md border py-2.5 pr-4 pl-9 text-sm outline-none focus:ring-2"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-foreground-muted hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 text-xs"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Category filter pills */}
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={[
              'rounded-full border px-3 py-1 text-xs transition-colors',
              activeCategory === null
                ? 'border-brand bg-brand/10 text-foreground font-medium'
                : 'border-border text-foreground-lighter hover:text-foreground',
            ].join(' ')}
          >
            All topics
          </button>
          {FAQ_WITH_ICONS.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(activeCategory === cat.id ? null : cat.id)}
                className={[
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                  activeCategory === cat.id
                    ? 'border-brand bg-brand/10 text-foreground font-medium'
                    : 'border-border text-foreground-lighter hover:text-foreground',
                ].join(' ')}
              >
                <Icon className="h-3 w-3" />
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Results count when filtering */}
        {(query || activeCategory) && (
          <p className="text-foreground-muted mb-4 text-xs">
            {totalResults} result{totalResults !== 1 ? 's' : ''}
            {query ? ` for "${query}"` : ''}
          </p>
        )}

        {/* FAQ Sections */}
        {filtered.length > 0 ? (
          <div className="space-y-6">
            {filtered.map((cat) => {
              const Icon = cat.icon;
              return (
                <div key={cat.id} className="border-border overflow-hidden rounded-lg border">
                  <div className="bg-surface-100 border-border flex items-center gap-2 border-b px-4 py-3">
                    <Icon className="text-foreground-lighter h-4 w-4" />
                    <h3 className="text-foreground text-sm font-medium">{cat.label}</h3>
                    <span className="text-foreground-muted ml-auto text-xs">
                      {cat.items.length}
                    </span>
                  </div>
                  <div>
                    {cat.items.map((item, i) => (
                      <FaqItemRow key={i} item={item} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border-border flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
            <div className="bg-surface-200 flex h-12 w-12 items-center justify-center rounded-full">
              <Search className="text-foreground-lighter h-6 w-6" />
            </div>
            <div>
              <p className="text-foreground text-sm font-medium">No results found</p>
              <p className="text-foreground-lighter mt-1 text-xs">
                Try different keywords, or contact support directly.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={workspaceHref('/support')}>Contact Support</Link>
            </Button>
          </div>
        )}

        {/* Still need help CTA */}
        {filtered.length > 0 && (
          <div className="border-border bg-surface-75 mt-8 flex items-center justify-between rounded-lg border p-5">
            <div>
              <p className="text-foreground text-sm font-medium">Still need help?</p>
              <p className="text-foreground-lighter mt-0.5 text-xs">
                Our team typically responds within one business day.
              </p>
            </div>
            <Button variant="default" size="sm" asChild>
              <Link href={workspaceHref('/support')}>
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Open a ticket
              </Link>
            </Button>
          </div>
        )}

        {/* Docs link */}
        <div className="mt-4 text-center">
          <a
            href={URL_DOCS}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground-muted inline-flex items-center gap-1.5 text-xs hover:underline"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Browse full documentation at {DOMAIN_DOCS}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
