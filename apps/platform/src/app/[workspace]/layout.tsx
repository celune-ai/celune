import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@repo/db/server';

interface WorkspaceLayoutProps {
  children: ReactNode;
  params: Promise<{ workspace: string }>;
}

/**
 * Server-side workspace resolution: validates the slug before rendering
 * any child pages. Redirects to /login if no session or to / if the
 * workspace slug is invalid. This avoids a client-side round-trip to
 * discover invalid slugs and enables future RSC data prefetching.
 */
export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { workspace: slug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Validate workspace slug exists and user has access
  const { data: ws } = await supabase
    .from('workspaces')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (!ws) {
    // Invalid workspace slug — redirect to root (workspace provider will pick default)
    redirect('/');
  }

  return <>{children}</>;
}
