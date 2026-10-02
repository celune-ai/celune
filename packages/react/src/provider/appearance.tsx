'use client';

import { createContext, useContext } from 'react';

/** Base tokens settable through `appearance.variables`, keyed by camelCase name. */
export const CELUNE_VARIABLES = {
  bg: '--celune-bg',
  surface: '--celune-surface',
  surfaceRaised: '--celune-surface-raised',
  surfaceMuted: '--celune-surface-muted',
  fg: '--celune-fg',
  fgMuted: '--celune-fg-muted',
  primary: '--celune-primary',
  primaryFg: '--celune-primary-fg',
  danger: '--celune-danger',
  border: '--celune-border',
  borderStrong: '--celune-border-strong',
  ring: '--celune-ring',
  radius: '--celune-radius',
  shadow: '--celune-shadow',
  shadowRaised: '--celune-shadow-raised',
  space: '--celune-space',
  fontFamily: '--celune-font',
  fontFamilyMono: '--celune-font-mono',
  duration: '--celune-duration',
  ease: '--celune-ease',
  statusBacklog: '--celune-status-backlog',
  statusInbox: '--celune-status-inbox',
  statusScoping: '--celune-status-scoping',
  statusPlanning: '--celune-status-planning',
  statusInProgress: '--celune-status-in-progress',
  statusReview: '--celune-status-review',
  statusDone: '--celune-status-done',
  statusArchived: '--celune-status-archived',
  priorityUrgent: '--celune-priority-urgent',
  priorityHigh: '--celune-priority-high',
  priorityNormal: '--celune-priority-normal',
  priorityLow: '--celune-priority-low',
  agent1: '--celune-agent-1',
  agent2: '--celune-agent-2',
  agent3: '--celune-agent-3',
  agent4: '--celune-agent-4',
  agent5: '--celune-agent-5',
  agent6: '--celune-agent-6',
  agent7: '--celune-agent-7',
  agent8: '--celune-agent-8',
  agent9: '--celune-agent-9',
  agent10: '--celune-agent-10',
  agent11: '--celune-agent-11',
  surfaceHover: '--celune-surface-hover',
  onStatus: '--celune-on-status',
} as const;

export type CeluneVariableName = keyof typeof CELUNE_VARIABLES;
export type CeluneVariables = Partial<Record<CeluneVariableName, string>>;

/** Parts that accept a class override through `appearance.elements`. */
export type CeluneElementName =
  | 'taskBoard'
  | 'boardColumn'
  | 'taskCard'
  | 'taskDrawer'
  | 'drawerHeader'
  | 'taskList'
  | 'taskRow'
  | 'addTaskRow'
  | 'projectCard';

export type CeluneElements = Partial<Record<CeluneElementName, string>>;

export type CeluneTheme = 'light' | 'dark' | 'auto';

export interface CeluneAppearance {
  /** Base palette for defaults.css. `auto` follows `.dark` or `[data-theme="dark"]` on `<html>`. */
  theme?: CeluneTheme;
  /** Values for `--celune-*` tokens. A host CSS variable wins over these; these win over defaults.css. */
  variables?: CeluneVariables;
  /** Extra classes appended to each part's root element. */
  elements?: CeluneElements;
}

/** Cascade layer order. Unlayered host CSS always wins over all three. */
export const CELUNE_LAYER_ORDER = '@layer celune-derived, celune-defaults, celune-appearance;';

const UNSAFE_VALUE = /[;{}<>]|\/\*/;

/**
 * Builds the stylesheet for `appearance.variables`. Declarations sit on `:root` so portalled
 * overlays inherit them, inside `celune-appearance` so unlayered host variables still win.
 */
export function buildAppearanceCss(variables: CeluneVariables | undefined): string {
  if (!variables) return '';
  const decls: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    const prop = CELUNE_VARIABLES[key as CeluneVariableName];
    if (!prop || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || UNSAFE_VALUE.test(trimmed)) continue;
    decls.push(`${prop}: ${trimmed};`);
  }
  if (decls.length === 0) return '';
  return `${CELUNE_LAYER_ORDER}\n@layer celune-appearance {\n  :root {\n    ${decls.join('\n    ')}\n  }\n}\n`;
}

const NO_ELEMENTS: CeluneElements = {};

export const CeluneElementsContext = createContext<CeluneElements>(NO_ELEMENTS);

/** Class override for a part, or undefined. Safe outside a provider. */
export function useElementClass(name: CeluneElementName): string | undefined {
  return useContext(CeluneElementsContext)[name];
}
