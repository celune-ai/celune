'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X, LogOut, Settings, MessageSquare, ChevronsUpDown } from 'lucide-react';
import { AppIconRail, ICON_SIZE } from '@repo/ui/app-icon-rail';
import { adminNav } from '@/lib/nav';
import { FeedbackPopover } from './feedback-popover';
import { ROLE_HIERARCHY } from '@/lib/roles';
import { useUserRole } from '@/hooks/use-user-role';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { usePlan } from '@/hooks/use-plan';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { WorkspaceSwitcher } from './workspace-switcher';

/* ----------------------------------------------------------------
   Logo mark — "S" in brand green
   ---------------------------------------------------------------- */
function LogoMark() {
  const { workspaceHref } = useWorkspaceHref();
  return (
    <Link href={workspaceHref('/')} aria-label="Celune home">
      <Image
        src="/celune-logomark.svg"
        alt="Celune"
        className="max-h-7 w-auto"
        width={28}
        height={28}
        unoptimized
      />
    </Link>
  );
}

/* ----------------------------------------------------------------
   Slack link with green connected dot
   ---------------------------------------------------------------- */
const SLACK_CHANNEL_URL = process.env.NEXT_PUBLIC_SLACK_CHANNEL_URL ?? '#';

function SlackLink() {
  return (
    <a
      href={SLACK_CHANNEL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
    >
      <div className="relative shrink-0">
        <MessageSquare size={20} strokeWidth={1} aria-hidden="true" />
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface-75)] bg-emerald-500" />
      </div>
      <span className="truncate">Slack</span>
    </a>
  );
}

/* ----------------------------------------------------------------
   User profile footer with popover
   ---------------------------------------------------------------- */
function UserProfileFooter() {
  const router = useRouter();
  const { workspaceHref } = useWorkspaceHref();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchJson<{
      display_name: string | null;
      email: string | undefined;
      avatar_url: string | null;
    }>(apiUrl('/api/user/profile'))
      .then((data) => {
        setDisplayName(data.display_name || data.email?.split('@')[0] || 'User');
        setAvatarUrl(data.avatar_url ?? null);
      })
      .catch(() => setDisplayName('User'));
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleLogout() {
    await fetch('/api/auth/signout', { method: 'POST' });
    setOpen(false);
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group/profile text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
      >
        {/* Avatar */}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-700">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
              width={28}
              height={28}
            />
          ) : (
            <Image
              src="/celune-logomark.svg"
              alt=""
              className="h-4 w-4 opacity-60"
              width={16}
              height={16}
              unoptimized
            />
          )}
        </div>
        <span className="text-foreground truncate font-medium">{displayName ?? '\u00A0'}</span>
        <ChevronsUpDown
          size={14}
          className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/profile:opacity-60"
        />
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className="border-border bg-surface-100 fixed bottom-3 z-50 w-44 rounded-lg border py-1 shadow-lg"
          style={{ left: 248 }}
        >
          <Link
            href={workspaceHref('/settings')}
            onClick={() => setOpen(false)}
            className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors"
          >
            <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
            Settings
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors"
          >
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------
   Logout button — used in mobile nav only
   ---------------------------------------------------------------- */
function LogoutButton({ onClick }: { onClick?: () => void }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/signout', { method: 'POST' });
    onClick?.();
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
    >
      <LogOut size={20} strokeWidth={1} className="shrink-0" aria-hidden="true" />
      <span className="truncate">Log out</span>
    </button>
  );
}

/* ----------------------------------------------------------------
   Mobile nav — top bar + slide-in drawer
   ---------------------------------------------------------------- */
function MobileNav({ visibleNav }: { visibleNav: typeof adminNav }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { workspaceHref } = useWorkspaceHref();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* Top bar */}
      <div className="border-border bg-surface-75 flex h-14 items-center gap-3 border-b px-4 lg:hidden">
        <LogoMark />
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher compact />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-foreground-muted hover:bg-surface-200 hover:text-foreground flex h-8 w-8 items-center justify-center rounded-md"
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        className={`bg-surface-75 fixed inset-y-0 left-0 z-50 flex w-72 transform flex-col transition-transform duration-200 ease-out lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <LogoMark />
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher compact />
          </div>
          <button
            type="button"
            onClick={close}
            className="text-foreground-muted hover:bg-surface-200 hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4" aria-label="Celune">
          {/* Main nav items (non-bottom) */}
          <div className="flex-1">
            {visibleNav
              .filter((item) => !item.bottom)
              .map((section) => {
                const Icon = section.icon;
                const href = section.external ? section.href : workspaceHref(section.href);
                const isActive =
                  !section.external &&
                  (section.href === '/' ? pathname === href : pathname.startsWith(href));
                const classes = `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-300 text-foreground'
                    : 'text-foreground-lighter hover:bg-surface-200 hover:text-foreground'
                }`;

                return (
                  <div key={section.href}>
                    {section.dividerBefore && (
                      <div className="border-border my-[16px] border-t" role="separator" />
                    )}
                    <div className="mb-1">
                      {section.external ? (
                        <a
                          href={section.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={close}
                          className={classes}
                        >
                          <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                          {section.label}
                        </a>
                      ) : (
                        <Link href={href} onClick={close} className={classes}>
                          <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                          {section.label}
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Bottom items: docs, feedback, logout */}
          <div className="border-border mt-3 border-t pt-3">
            {visibleNav
              .filter((item) => item.bottom)
              .map((section) => {
                const Icon = section.icon;
                const href = section.external ? section.href : workspaceHref(section.href);
                const isActive = !section.external && pathname.startsWith(href);
                const classes = `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-300 text-foreground'
                    : 'text-foreground-lighter hover:bg-surface-200 hover:text-foreground'
                }`;

                // Feedback trigger → popover instead of link
                if (section.isFeedbackTrigger) {
                  return (
                    <div key="feedback" className="mt-1">
                      <FeedbackPopover>
                        <button type="button" className={classes}>
                          <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                          {section.label}
                        </button>
                      </FeedbackPopover>
                    </div>
                  );
                }

                return (
                  <div key={section.href} className="mt-1">
                    {section.external ? (
                      <a
                        href={section.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={close}
                        className={classes}
                      >
                        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                        {section.label}
                      </a>
                    ) : (
                      <Link href={href} onClick={close} className={classes}>
                        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                        {section.label}
                      </Link>
                    )}
                  </div>
                );
              })}
            <LogoutButton onClick={close} />
          </div>
        </nav>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------
   AdminNav
   ---------------------------------------------------------------- */
export function AdminNav() {
  const { role, loading } = useUserRole();
  const { workspaceHref } = useWorkspaceHref();
  const { hasFeature, isLoading: planLoading } = usePlan();
  const { activeWorkspace } = useWorkspace();
  const [slackConnected, setSlackConnected] = useState(false);

  // Check if Slack integration is connected
  useEffect(() => {
    if (!activeWorkspace?.id) return;
    fetchJson<{ integrations: Array<{ id: string; status: string }> }>(
      apiUrl(`/api/integrations/status?workspace_id=${activeWorkspace.id}`),
    )
      .then((res) => {
        const slack = res.integrations.find((i) => i.id === 'slack');
        setSlackConnected(slack?.status === 'connected');
      })
      .catch(() => {});
  }, [activeWorkspace?.id]);

  // While loading, show an empty list (skeleton renders in place).
  // Once the role resolves, filter down to what the user is allowed to see.
  const visibleNav =
    loading || planLoading
      ? []
      : adminNav.filter((item) => {
          // Role check
          if (
            item.minRole &&
            (role === null || ROLE_HIERARCHY[role] < ROLE_HIERARCHY[item.minRole])
          ) {
            return false;
          }
          // Feature-gated items hidden when plan doesn't include the feature
          if (item.requiredFeature && !hasFeature(item.requiredFeature)) {
            return false;
          }
          return true;
        });

  const iconItems = useMemo(
    () =>
      visibleNav
        .filter((item) => !item.bottom)
        .map((item) => ({
          icon: item.icon,
          href: item.external ? item.href : workspaceHref(item.href),
          label: item.label,
          external: item.external,
          dividerBefore: item.dividerBefore,
        })),
    [visibleNav, workspaceHref],
  );

  const feedbackNavItem = visibleNav.find((item) => item.isFeedbackTrigger);

  const bottomItems = useMemo(
    () =>
      visibleNav
        .filter((item) => item.bottom && !item.isFeedbackTrigger)
        .map((item) => ({
          icon: item.icon,
          href: item.external ? item.href : workspaceHref(item.href),
          label: item.label,
          external: item.external,
        })),
    [visibleNav, workspaceHref],
  );

  const isLoading = loading || planLoading;

  return (
    <>
      {/* Desktop: sticky left panel — height adjusts for banners */}
      <div
        className="sticky top-0 left-0 z-30 hidden h-full shrink-0 lg:block"
        style={{ width: 240 }}
      >
        {isLoading ? (
          <NavSkeleton />
        ) : (
          <AppIconRail
            items={iconItems}
            bottomItems={bottomItems}
            bottomAction={
              <>
                {slackConnected && <SlackLink />}
                {feedbackNavItem && (
                  <FeedbackPopover>
                    <button
                      type="button"
                      aria-label="Provide feedback"
                      className="text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
                    >
                      <feedbackNavItem.icon
                        size={ICON_SIZE}
                        strokeWidth={1}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <span className="truncate">{feedbackNavItem.label}</span>
                    </button>
                  </FeedbackPopover>
                )}
              </>
            }
            statusSlot={null}
            footerSlot={<UserProfileFooter />}
            logo={<LogoMark />}
            logoAction={<WorkspaceSwitcher compact />}
          />
        )}
      </div>

      {/* Mobile: top bar + drawer — hidden while loading */}
      {!isLoading && <MobileNav visibleNav={visibleNav} />}
    </>
  );
}

/* ----------------------------------------------------------------
   NavSkeleton — placeholder while role/plan loads
   ---------------------------------------------------------------- */
function NavSkeleton() {
  return (
    <div className="border-border bg-surface-75 flex h-full w-full flex-col border-r">
      {/* Logo header */}
      <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b pr-2 pl-4">
        <LogoMark />
      </div>

      {/* Skeleton nav items */}
      <div className="flex flex-1 flex-col gap-1.5 px-2 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
            <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-white/[0.06]" />
            <div
              className="h-3.5 animate-pulse rounded bg-white/[0.06]"
              style={{ width: `${60 + (i % 3) * 20}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
