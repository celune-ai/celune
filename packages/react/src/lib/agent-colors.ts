/**
 * Identity colors for each agent, as --celune-agent-* references. Values come from the host
 * mapping or defaults.css. `color` is a CSS color value, usable in style props and color-mix.
 */
export interface AgentColor {
  color: string;
  text: string;
  bg: string;
  border: string;
  ring: string;
}

const RICK_COLOR: AgentColor = {
  color: 'var(--celune-agent-2)',
  text: 'text-(--celune-agent-2)',
  bg: 'bg-(--celune-agent-2)',
  border: 'border-(--celune-agent-2)',
  ring: 'ring-(--celune-agent-2)/60',
};

export const AGENT_COLORS: Record<string, AgentColor> = {
  eric: {
    color: 'var(--celune-agent-1)',
    text: 'text-(--celune-agent-1)',
    bg: 'bg-(--celune-agent-1)',
    border: 'border-(--celune-agent-1)',
    ring: 'ring-(--celune-agent-1)/60',
  },
  rick: RICK_COLOR,
  sage: {
    color: 'var(--celune-agent-3)',
    text: 'text-(--celune-agent-3)',
    bg: 'bg-(--celune-agent-3)',
    border: 'border-(--celune-agent-3)',
    ring: 'ring-(--celune-agent-3)/60',
  },
  noir: {
    color: 'var(--celune-agent-4)',
    text: 'text-(--celune-agent-4)',
    bg: 'bg-(--celune-agent-4)',
    border: 'border-(--celune-agent-4)',
    ring: 'ring-(--celune-agent-4)/60',
  },
  scan: {
    color: 'var(--celune-agent-5)',
    text: 'text-(--celune-agent-5)',
    bg: 'bg-(--celune-agent-5)',
    border: 'border-(--celune-agent-5)',
    ring: 'ring-(--celune-agent-5)/60',
  },
  delv: {
    color: 'var(--celune-agent-6)',
    text: 'text-(--celune-agent-6)',
    bg: 'bg-(--celune-agent-6)',
    border: 'border-(--celune-agent-6)',
    ring: 'ring-(--celune-agent-6)/60',
  },
  trek: {
    color: 'var(--celune-agent-7)',
    text: 'text-(--celune-agent-7)',
    bg: 'bg-(--celune-agent-7)',
    border: 'border-(--celune-agent-7)',
    ring: 'ring-(--celune-agent-7)/60',
  },
  echo: {
    color: 'var(--celune-agent-8)',
    text: 'text-(--celune-agent-8)',
    bg: 'bg-(--celune-agent-8)',
    border: 'border-(--celune-agent-8)',
    ring: 'ring-(--celune-agent-8)/60',
  },
  bond: {
    color: 'var(--celune-agent-9)',
    text: 'text-(--celune-agent-9)',
    bg: 'bg-(--celune-agent-9)',
    border: 'border-(--celune-agent-9)',
    ring: 'ring-(--celune-agent-9)/60',
  },
  vita: {
    color: 'var(--celune-agent-10)',
    text: 'text-(--celune-agent-10)',
    bg: 'bg-(--celune-agent-10)',
    border: 'border-(--celune-agent-10)',
    ring: 'ring-(--celune-agent-10)/60',
  },
  ward: {
    color: 'var(--celune-agent-11)',
    text: 'text-(--celune-agent-11)',
    bg: 'bg-(--celune-agent-11)',
    border: 'border-(--celune-agent-11)',
    ring: 'ring-(--celune-agent-11)/60',
  },
};

export function getAgentColor(agentId: string): AgentColor {
  return AGENT_COLORS[agentId] ?? RICK_COLOR;
}
