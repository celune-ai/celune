import { useCallback, useMemo, type ReactNode } from 'react';
import { Link as RouterLink, useOutletContext } from 'react-router';
import { CeluneProvider, type LinkProps } from '@celuneai/react';
import { orgPath } from '#app/lib/org-path.js';
import type { CeluneEmbed } from '#server/celune.server.js';
import '#app/celune.css';

function CeluneLink({ href, children, ...rest }: LinkProps) {
  return (
    <RouterLink to={href} {...rest}>
      {children}
    </RouterLink>
  );
}

/** Mounts CeluneProvider for one org. The browser talks only to the Celune sidecar, with the embed token. */
export function CeluneMount({ embed, children }: { embed: CeluneEmbed; children: ReactNode }) {
  const { org, user } = useOutletContext<{
    org: { slug: string };
    user?: { name?: string | null; email?: string | null };
  }>();
  const href = useCallback((path: string) => orgPath(org.slug, path), [org.slug]);
  const refreshToken = useCallback(async () => {
    const res = await fetch(`/api/celune/token?org=${encodeURIComponent(org.slug)}`, {
      method: 'POST',
    });
    if (!res.ok) return null;
    return ((await res.json()) as { token: string | null }).token;
  }, [org.slug]);
  const currentUser = useMemo(
    () => ({ displayName: user?.name ?? user?.email ?? 'You' }),
    [user?.name, user?.email],
  );

  return (
    <CeluneProvider
      apiUrl={embed.apiUrl}
      token={embed.token}
      workspaceId={embed.workspaceId}
      refreshToken={refreshToken}
      Link={CeluneLink}
      href={href}
      canEdit={embed.canEdit}
      currentUser={currentUser}
      pollInterval={5000}
    >
      {children}
    </CeluneProvider>
  );
}
