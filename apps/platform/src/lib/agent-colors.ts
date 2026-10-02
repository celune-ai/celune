/**
 * Identity colors for each Celune agent, as literal hex. The platform needs literals for chart
 * fills, SVG, and saved agent colors; @celuneai/react reads the same values through the
 * --celune-agent-* tokens mapped in app/celune-theme.css.
 */
export interface AgentColor {
  hex: string;
  text: string;
  bg: string;
  border: string;
  ring: string;
}

export const AGENT_COLORS: Record<string, AgentColor> = {
  eric: {
    hex: '#56CCF2',
    text: 'text-sky-400',
    bg: 'bg-sky-400',
    border: 'border-sky-400',
    ring: 'ring-sky-400/60',
  },
  rick: {
    hex: '#3DD68C',
    text: 'text-brand',
    bg: 'bg-brand',
    border: 'border-brand',
    ring: 'ring-brand/60',
  },
  sage: {
    hex: '#4DD4AC',
    text: 'text-teal-400',
    bg: 'bg-teal-400',
    border: 'border-teal-400',
    ring: 'ring-teal-400/60',
  },
  noir: {
    hex: '#F2A0C4',
    text: 'text-pink-400',
    bg: 'bg-pink-400',
    border: 'border-pink-400',
    ring: 'ring-pink-400/60',
  },
  scan: {
    hex: '#6EE7A0',
    text: 'text-green-400',
    bg: 'bg-green-400',
    border: 'border-green-400',
    ring: 'ring-green-400/60',
  },
  delv: {
    hex: '#9B8AFB',
    text: 'text-indigo-400',
    bg: 'bg-indigo-400',
    border: 'border-indigo-400',
    ring: 'ring-indigo-400/60',
  },
  trek: {
    hex: '#BBE44D',
    text: 'text-lime-400',
    bg: 'bg-lime-400',
    border: 'border-lime-400',
    ring: 'ring-lime-400/60',
  },
  echo: {
    hex: '#C89BFC',
    text: 'text-purple-400',
    bg: 'bg-purple-400',
    border: 'border-purple-400',
    ring: 'ring-purple-400/60',
  },
  bond: {
    hex: '#76B4FC',
    text: 'text-blue-400',
    bg: 'bg-blue-400',
    border: 'border-blue-400',
    ring: 'ring-blue-400/60',
  },
  vita: {
    hex: '#F08CF6',
    text: 'text-fuchsia-400',
    bg: 'bg-fuchsia-400',
    border: 'border-fuchsia-400',
    ring: 'ring-fuchsia-400/60',
  },
  ward: {
    hex: '#F87171',
    text: 'text-red-400',
    bg: 'bg-red-400',
    border: 'border-red-400',
    ring: 'ring-red-400/60',
  },
};

export function getAgentColor(agentId: string): AgentColor {
  return AGENT_COLORS[agentId] ?? AGENT_COLORS.rick;
}

/** Full agent color palette, used in the agent settings panel. Saved to the agent row as hex. */
export const AGENT_COLOR_PRESETS = [
  '#3DD68C',
  '#6EE7A0',
  '#4DD4AC',
  '#F2A0C4',
  '#9B8AFB',
  '#F59E0B',
  '#3B82F6',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
] as const;

/** Compact agent color palette, used in the onboarding wizard quick-create. */
export const AGENT_COLOR_PRESETS_COMPACT = [
  '#3DD68C',
  '#3B82F6',
  '#8B5CF6',
  '#F59E0B',
  '#EC4899',
  '#6366F1',
] as const;
