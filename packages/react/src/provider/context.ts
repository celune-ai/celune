'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { Task } from '@repo/types';
import type { CeluneTransport, SubscribeFn } from '../transport/types';

export interface LinkProps {
  href: string;
  className?: string;
  children?: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  title?: string;
  target?: string;
  rel?: string;
  'aria-label'?: string;
}

export type LinkComponent = ComponentType<LinkProps>;

export interface AiTaskDialogSlotProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  onGenerating?: () => void;
  onGenerated?: (task: Task) => void;
  onCreated?: (task: Task) => void;
  onError?: (msg: string) => void;
}

/** Host-rendered extensions. Voice, AI, and plan gates live in the host app. */
export interface CeluneSlots {
  aiTaskDialog?: ComponentType<AiTaskDialogSlotProps>;
  /** Rendered at the top of the task drawer body. */
  drawerBanner?: ReactNode;
}

export interface CeluneCurrentUser {
  displayName: string;
  /** Assignee value written when the user claims a task. Claiming is hidden without it. */
  assignee?: string;
}

export type ConnectionStatus = 'connected' | 'refreshing' | 'read-only';

export interface CeluneContextValue {
  transport: CeluneTransport;
  workspaceId: string;
  subscribe?: SubscribeFn;
  pollInterval: number;
  Link: LinkComponent;
  href: (path: string) => string;
  canEdit: boolean;
  connection: ConnectionStatus;
  reconnect: () => Promise<boolean>;
  currentUser: CeluneCurrentUser;
  slots: CeluneSlots;
  onMigrationIssue?: () => void;
}

export const CeluneContext = createContext<CeluneContextValue | null>(null);

export function useCelune(): CeluneContextValue {
  const ctx = useContext(CeluneContext);
  if (!ctx) throw new Error('useCelune must be used inside <CeluneProvider>');
  return ctx;
}

export function useCanEdit(): boolean {
  return useCelune().canEdit;
}

export function useCeluneHref() {
  const { href } = useCelune();
  return { workspaceHref: href };
}
