'use client';

import { useWorkspace } from '@/providers/workspace-provider';
import { IdeSetupPanel } from '@/components/ide-setup-panel';

export function IdeConnectionsCard() {
  const { activeWorkspace } = useWorkspace();

  if (!activeWorkspace?.id) return null;

  return <IdeSetupPanel workspaceId={activeWorkspace.id} variant="settings" />;
}
