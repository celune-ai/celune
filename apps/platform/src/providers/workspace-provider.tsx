'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { adminNav } from '@/lib/nav';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/roles';
import type { Workspace } from '@repo/types';
import { clearPermissionsCache } from '@/hooks/use-permissions';

const SLUG_STORAGE_KEY = 'activeWorkspaceSlug';

/** Mirror workspace slug to a cookie so the RSC root redirect can read it server-side */
function syncSlugCookie(slug: string) {
  const secure = window.location.protocol === 'https:' ? ';secure' : '';
  document.cookie = `${SLUG_STORAGE_KEY}=${slug};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax${secure}`;
}

/** Fire-and-forget sync of active workspace to Claude Code state file */
function syncWorkspaceToState(ws: Workspace) {
  fetch('/api/workspace-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: ws.id, workspace_name: ws.name, slug: ws.slug }),
  }).catch(() => {
    /* Fire-and-forget — state file sync is best-effort */
  });
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspace: (workspace: Workspace) => void;
  /** Switch to a workspace by slug, optionally navigating to a specific page path. Returns false if slug not found. */
  switchToWorkspaceBySlug: (slug: string, path?: string) => boolean;
  /** Re-fetch workspaces from the server and refresh active workspace data. */
  refreshWorkspaces: () => Promise<void>;
  isLoading: boolean;
  /** The current user's org-level role, or null while loading. */
  userRole: UserRole | null;
  /** True when Main (is_default) workspace is selected — shows aggregated data for owner/admin. */
  isMainWorkspace: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspaces: [],
  activeWorkspace: null,
  setActiveWorkspace: () => {},
  switchToWorkspaceBySlug: () => false,
  refreshWorkspaces: async () => {},
  isLoading: true,
  userRole: null,
  isMainWorkspace: false,
});

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

/**
 * Extracts the page path after the workspace slug.
 * E.g. /main/tasks/123 → /tasks/123
 */
function getPagePath(pathname: string, slug: string): string {
  const prefix = `/${slug}`;
  if (pathname.startsWith(prefix)) {
    const rest = pathname.slice(prefix.length);
    return rest || '/';
  }
  return '/';
}

/**
 * Extracts just the top-level page segment from a page path.
 * E.g. /projects/abc-123 → /projects, /analytics/cost → /analytics
 * Child pages get collapsed to their parent so we don't navigate
 * to a detail page that doesn't exist in the new workspace.
 */
function getTopLevelPage(pagePath: string): string {
  const segments = pagePath.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  return `/${segments[0]}`;
}

/**
 * Check if a nav item is accessible for the given role.
 * Returns true if the user's role meets or exceeds the minRole requirement,
 * and the item is not internal-only for external users.
 */
function canAccessPage(page: string, role: UserRole | null, isPlatformOwner: boolean): boolean {
  const navItem = adminNav.find((item) => item.href === page);
  // Unknown pages (settings, notifications, etc.) — allow by default
  if (!navItem) return true;
  // Check minRole
  if (navItem.minRole && role) {
    return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[navItem.minRole];
  }
  if (navItem.minRole && !role) return false;
  return true;
}

/** Default landing page when we can't preserve the current page */
const DEFAULT_PAGE = '/projects';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ workspace: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const urlSlug = params.workspace;

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  // Keep a ref to userRole so the callback doesn't need it as a dependency
  const userRoleRef = useRef(userRole);
  useEffect(() => {
    userRoleRef.current = userRole;
  }, [userRole]);

  const setActiveWorkspace = useCallback(
    (workspace: Workspace) => {
      setActiveWorkspaceState(workspace);
      syncWorkspaceToState(workspace);

      // Purge all module-level caches to prevent stale cross-workspace data
      clearPermissionsCache();

      try {
        localStorage.setItem(SLUG_STORAGE_KEY, workspace.slug);
        syncSlugCookie(workspace.slug);
      } catch {
        // localStorage may be unavailable
      }

      // Preserve the current top-level page when switching workspaces.
      // Strip child paths (e.g. /projects/abc → /projects) since detail
      // pages are workspace-specific and won't exist in the new workspace.
      const currentSlug = params.workspace;
      const pagePath = currentSlug ? getPagePath(pathname, currentSlug) : '/';
      const topPage = getTopLevelPage(pagePath);

      const role = userRoleRef.current;
      // TODO: isPlatformOwner should come from a real check; for now infer from owner role
      const isPlatformOwner = role === 'owner';

      let targetPage = topPage;

      // If user can't access this page in the new workspace, fall back
      if (targetPage !== '/' && !canAccessPage(targetPage, role, isPlatformOwner)) {
        targetPage = DEFAULT_PAGE;
      }
      // If still can't access, go to workspace root
      if (!canAccessPage(targetPage, role, isPlatformOwner)) {
        targetPage = '/';
      }

      const suffix = targetPage === '/' ? '' : targetPage;
      router.push(`/${workspace.slug}${suffix}`);
    },
    [router, params.workspace, pathname],
  );

  const switchToWorkspaceBySlug = useCallback(
    (slug: string, path?: string): boolean => {
      const target = workspaces.find((w) => w.slug === slug);
      if (!target) return false;
      setActiveWorkspaceState(target);
      try {
        localStorage.setItem(SLUG_STORAGE_KEY, target.slug);
        syncSlugCookie(target.slug);
      } catch {}
      router.push(`/${target.slug}${path ?? ''}`);
      return true;
    },
    [workspaces, router],
  );

  const refreshWorkspaces = useCallback(async () => {
    try {
      const data = await fetchJson<Workspace[]>(apiUrl('/api/workspaces'));
      if (Array.isArray(data)) {
        setWorkspaces(data);
        // Re-sync active workspace with fresh data
        setActiveWorkspaceState((prev) => {
          if (!prev) return prev;
          return data.find((w) => w.id === prev.id) ?? prev;
        });
      }
    } catch {
      // Non-fatal — caller decides whether to show an error
    }
  }, []);

  // Capture pathname at mount time for redirect logic — don't re-run on every navigation
  const initialPathnameRef = useRef(pathname);
  useEffect(() => {
    initialPathnameRef.current = pathname;
  }, [pathname]);

  // Track whether initial load has completed to prevent re-fetching on every navigation
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    // Only run once per slug change, not on every pathname change
    if (hasLoadedRef.current && activeWorkspace?.slug === urlSlug) return;

    let cancelled = false;

    Promise.all([
      fetchJson<Workspace[]>(apiUrl('/api/workspaces')),
      fetchJson<{ role: UserRole }>(apiUrl('/api/user/role')),
    ])
      .then(([data, roleData]) => {
        if (cancelled) return;

        if (Array.isArray(data)) {
          setWorkspaces(data);

          // No workspaces — redirect to onboarding (skip for device verify + auth pages)
          if (data.length === 0) {
            const path = window.location.pathname;
            if (!path.startsWith('/device/') && !path.startsWith('/auth/')) {
              router.replace('/onboarding');
              return;
            }
          }

          // Find workspace matching URL slug
          const matchedBySlug = urlSlug ? data.find((w) => w.slug === urlSlug) : undefined;

          if (matchedBySlug) {
            setActiveWorkspaceState(matchedBySlug);
            syncWorkspaceToState(matchedBySlug);
            try {
              localStorage.setItem(SLUG_STORAGE_KEY, matchedBySlug.slug);
              syncSlugCookie(matchedBySlug.slug);
            } catch {}
          } else {
            // Invalid slug — redirect to default workspace
            const defaultWs =
              (data.length === 1 ? data[0] : null) ??
              data.find((w) => w.is_default) ??
              data[0] ??
              null;

            if (defaultWs) {
              setActiveWorkspaceState(defaultWs);
              syncWorkspaceToState(defaultWs);
              try {
                localStorage.setItem(SLUG_STORAGE_KEY, defaultWs.slug);
                syncSlugCookie(defaultWs.slug);
              } catch {}
              // Redirect to default workspace, preserving page path
              const currentPath = initialPathnameRef.current;
              const pagePath = urlSlug ? getPagePath(currentPath, urlSlug) : '/';
              router.replace(`/${defaultWs.slug}${pagePath === '/' ? '' : pagePath}`);
            }
          }
        }

        if (roleData && typeof roleData === 'object' && 'role' in roleData) {
          setUserRole(roleData.role);
        }

        hasLoadedRef.current = true;
      })
      .catch(() => {
        // Silently fail — workspace switching is non-critical
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [urlSlug, router]);

  const isMainWorkspace = activeWorkspace?.is_default === true;

  const value = useMemo(
    () => ({
      workspaces,
      activeWorkspace,
      setActiveWorkspace,
      switchToWorkspaceBySlug,
      refreshWorkspaces,
      isLoading,
      userRole,
      isMainWorkspace,
    }),
    [
      workspaces,
      activeWorkspace,
      setActiveWorkspace,
      switchToWorkspaceBySlug,
      refreshWorkspaces,
      isLoading,
      userRole,
      isMainWorkspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
