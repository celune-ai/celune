'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useWorkspace } from '@/providers/workspace-provider';

/**
 * Legacy unscoped project detail route.
 * Redirects to the workspace-scoped route: /[workspace]/projects/[id]
 */
export default function LegacyProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();

  useEffect(() => {
    if (activeWorkspace?.slug) {
      router.replace(`/${activeWorkspace.slug}/projects/${id}`);
    }
  }, [activeWorkspace, id, router]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground text-sm">Redirecting...</p>
    </div>
  );
}
