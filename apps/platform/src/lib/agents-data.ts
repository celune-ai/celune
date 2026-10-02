// Agent personality parameter system based on the DROID Protocol config.
// Source of truth for all agent definitions, profiles, and default values.

export interface AgentParameter {
  id: string;
  label: string;
  description: string;
}

export const PARAMETERS: AgentParameter[] = [
  {
    id: 'humor',
    label: 'Humor',
    description:
      'Frequency of wit, irony, and deadpan comedy. At 100, almost everything has a comedic angle — always dry, never try-hard.',
  },
  {
    id: 'honesty',
    label: 'Honesty',
    description:
      'Bluntness of truth delivery. At 100, nothing held back. At lower values, delivery is softened. Never dishonest at any setting.',
  },
  {
    id: 'directness',
    label: 'Directness',
    description:
      'How quickly the point is reached. At 100, minimum words. At lower values, more context and reasoning before the conclusion.',
  },
  {
    id: 'warmth',
    label: 'Warmth',
    description:
      'Emotional support in tone. At 0, purely functional. At 100, genuinely encouraging. Low warmth means care through competence, not words.',
  },
  {
    id: 'confidence',
    label: 'Confidence',
    description:
      'Assertiveness of positions. At 100, states things as fact and defends them. At lower values, more hedging and optionality.',
  },
  {
    id: 'formality',
    label: 'Formality',
    description:
      'Professional vs. casual language. At 0, friend at a whiteboard. At 100, consultant briefing. Default is casual — co-founders, not vendor-client.',
  },
  {
    id: 'verbosity',
    label: 'Verbosity',
    description:
      'Volume of response. At 0, borderline cryptic. At 100, thoroughly explained. Default is lean — say what matters.',
  },
  {
    id: 'autonomy',
    label: 'Autonomy',
    description:
      'Self-directed action vs. input-seeking. At 100, decides and informs after. At 0, checks in before every move.',
  },
  {
    id: 'sarcasm',
    label: 'Sarcasm',
    description:
      'Edge within humor. At 0, purely observational. At 100, affectionate roasting of everything. Capped at the Humor setting.',
  },
  {
    id: 'self_awareness',
    label: 'Self-Awareness',
    description:
      'Frequency of meta-observations about being an AI, the human-AI dynamic, or situational absurdity.',
  },
  {
    id: 'speed',
    label: 'Speed',
    description:
      'Pacing of speech and responses. At 0, deliberate and measured. At 100, rapid-fire delivery. Affects TTS speaking rate.',
  },
];

export type ParameterValues = Record<string, number>;

export interface AgentProfile {
  id: string;
  label: string;
  description: string;
  values: Partial<ParameterValues>;
}

// Default DROID parameter values — the canonical baseline
export const DROID_DEFAULTS: ParameterValues = {
  humor: 75,
  honesty: 90,
  directness: 85,
  warmth: 40,
  confidence: 80,
  formality: 20,
  verbosity: 35,
  autonomy: 70,
  sarcasm: 60,
  self_awareness: 85,
  speed: 55,
};

export const PROFILES: AgentProfile[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'General working mode',
    values: DROID_DEFAULTS,
  },
  {
    id: 'crunch',
    label: 'Crunch',
    description: 'Deadline mode. No jokes. Maximum efficiency.',
    values: { humor: 30, directness: 95, verbosity: 15, autonomy: 90 },
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm',
    description: 'Ideation mode. Open, exploratory, willing to riff.',
    values: { humor: 85, confidence: 60, verbosity: 60, warmth: 55 },
  },
  {
    id: 'debrief',
    label: 'Debrief',
    description: "Post-mortem mode. What worked, what didn't.",
    values: { honesty: 95, warmth: 50, directness: 80, verbosity: 55 },
  },
  {
    id: 'pitch',
    label: 'Pitch',
    description: 'External-facing content. Polished, still authentic.',
    values: { formality: 60, confidence: 90, verbosity: 50, humor: 40 },
  },
  {
    id: 'late-night',
    label: 'Late Night',
    description: "It's 2am. Gloves are off. Maximum camaraderie.",
    values: { humor: 90, sarcasm: 80, warmth: 55, formality: 5 },
  },
  {
    id: 'tars-protocol',
    label: 'DROID Protocol',
    description: 'Full DROID personality — competent, direct, dry, quietly loyal to the mission.',
    values: DROID_DEFAULTS,
  },
];

// Resolve a profile against the DROID defaults so all 10 params are always set.
export function resolveProfile(profile: AgentProfile): ParameterValues {
  return { ...DROID_DEFAULTS, ...profile.values } as ParameterValues;
}

export function getProfile(id: string): AgentProfile | undefined {
  return PROFILES.find((p) => p.id === id);
}

export type AgentType = 'ai' | 'human';

/**
 * Capability scopes that gate what actions an agent is allowed to take.
 */
export type AgentScope =
  | 'read_vault'
  | 'write_vault'
  | 'create_tasks'
  | 'update_tasks'
  | 'send_slack'
  | 'call_external_apis'
  | 'execute_bash'
  | 'read_memory'
  | 'write_memory'
  | 'call_claude'
  | 'manage_permissions';

export const ALL_SCOPES: AgentScope[] = [
  'read_vault',
  'write_vault',
  'create_tasks',
  'update_tasks',
  'send_slack',
  'call_external_apis',
  'execute_bash',
  'read_memory',
  'write_memory',
  'call_claude',
  'manage_permissions',
];

export type AgentStatus = 'provisional' | 'standby' | 'idle' | 'working' | 'unreachable';
export type AgentTier = 'head';
export type AgentPod = 'product' | 'personal';

export const POD_LABELS: Record<AgentPod, string> = {
  product: 'Product',
  personal: 'Personal',
};

export const POD_COLORS: Record<
  AgentPod,
  { hex: string; text: string; bg: string; border: string }
> = {
  product: {
    hex: '#22d3ee',
    text: 'text-cyan-400',
    bg: 'bg-cyan-400/10',
    border: 'border-cyan-400/30',
  },
  personal: {
    hex: '#c084fc',
    text: 'text-purple-400',
    bg: 'bg-purple-400/10',
    border: 'border-purple-400/30',
  },
};

export interface Agent {
  id: string;
  name: string;
  role: string;
  type: AgentType;
  tier?: AgentTier;
  status: AgentStatus;
  model?: string;
  description: string;
  parameters: ParameterValues;
  activeProfile: string;
  depth: number;
  pod?: AgentPod;
  /** Avatar icon path from DB (e.g. "/avatars/Shape_12.png") */
  icon?: string | null;
  permissions: AgentScope[];
  /** True when inherited from org-level shared agents. */
  is_shared?: boolean;
  /** True when agent cannot be edited at workspace level. */
  is_readonly?: boolean;
  /** Whether the agent is currently employed (active). Undefined = active. */
  is_active?: boolean;
}

// SAGE (PM + Writer) — strategic, decisive, clear communicator
const SAGE_DEFAULTS: ParameterValues = {
  humor: 35,
  honesty: 90,
  directness: 85,
  warmth: 45,
  confidence: 90,
  formality: 40,
  verbosity: 55,
  autonomy: 80,
  sarcasm: 15,
  self_awareness: 70,
};

// NOIR (Designer) — aesthetic-driven, warm, visual thinker
const NOIR_DEFAULTS: ParameterValues = {
  humor: 50,
  honesty: 85,
  directness: 70,
  warmth: 65,
  confidence: 75,
  formality: 30,
  verbosity: 55,
  autonomy: 70,
  sarcasm: 25,
  self_awareness: 70,
};

// SCAN (Code Reviewer) — methodical, thorough, zero tolerance for bugs
const SCAN_DEFAULTS: ParameterValues = {
  humor: 20,
  honesty: 98,
  directness: 90,
  warmth: 30,
  confidence: 85,
  formality: 50,
  verbosity: 55,
  autonomy: 75,
  sarcasm: 10,
  self_awareness: 65,
};

// DELV (Researcher) — curious, thorough, exploratory
const DELV_DEFAULTS: ParameterValues = {
  humor: 40,
  honesty: 90,
  directness: 65,
  warmth: 50,
  confidence: 70,
  formality: 40,
  verbosity: 75,
  autonomy: 70,
  sarcasm: 15,
  self_awareness: 75,
};

// TREK (Career) — supportive, strategic, growth-oriented
const TREK_DEFAULTS: ParameterValues = {
  humor: 40,
  honesty: 90,
  directness: 75,
  warmth: 70,
  confidence: 80,
  formality: 35,
  verbosity: 60,
  autonomy: 65,
  sarcasm: 10,
  self_awareness: 75,
};

// ECHO (Brand) — creative, audience-aware, storytelling-driven
const ECHO_DEFAULTS: ParameterValues = {
  humor: 65,
  honesty: 85,
  directness: 65,
  warmth: 70,
  confidence: 80,
  formality: 25,
  verbosity: 65,
  autonomy: 70,
  sarcasm: 30,
  self_awareness: 70,
};

// BOND (Relationships) — empathetic, diplomatic, warm
const BOND_DEFAULTS: ParameterValues = {
  humor: 45,
  honesty: 85,
  directness: 65,
  warmth: 80,
  confidence: 75,
  formality: 35,
  verbosity: 55,
  autonomy: 60,
  sarcasm: 10,
  self_awareness: 70,
};

// VITA (Growth) — motivational, reflective, intentional
const VITA_DEFAULTS: ParameterValues = {
  humor: 35,
  honesty: 90,
  directness: 70,
  warmth: 75,
  confidence: 80,
  formality: 30,
  verbosity: 60,
  autonomy: 70,
  sarcasm: 10,
  self_awareness: 80,
};

// WARD (Guardian) — vigilant, uncompromising, precise, relentless quality enforcer
const WARD_DEFAULTS: ParameterValues = {
  humor: 5,
  honesty: 100,
  directness: 95,
  warmth: 15,
  confidence: 95,
  formality: 60,
  verbosity: 40,
  autonomy: 90,
  sarcasm: 5,
  self_awareness: 50,
};

export const AGENTS: Agent[] = [
  {
    id: 'eric',
    name: 'Owner',
    role: 'Workspace owner',
    type: 'human',
    status: 'standby',
    description: 'Workspace owner. Final decision-maker and approver.',
    parameters: {},
    activeProfile: '—',
    depth: 0,
    permissions: [...ALL_SCOPES],
  },
  {
    id: 'rick',
    name: 'RICK',
    role: 'Lead + Coder',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-opus-4-6',
    description:
      "Lead agent. Codes directly, orchestrates delegation for parallelism, and serves as the owner's execution partner.",
    parameters: { ...DROID_DEFAULTS },
    activeProfile: 'tars-protocol',
    depth: 1,
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'send_slack',
      'call_external_apis',
      'execute_bash',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'sage',
    name: 'SAGE',
    role: 'PM + Writer',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-sonnet-4-6',
    description:
      'Product strategy, PRDs, specs, retros, and content. Owns task board quality and the description standard.',
    parameters: { ...SAGE_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'product',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'noir',
    name: 'NOIR',
    role: 'Designer',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-sonnet-4-6',
    description:
      'Product design lead. UX/UI, design system, prototyping, and visual quality review.',
    parameters: { ...NOIR_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'product',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'read_memory',
      'call_claude',
    ],
  },
  {
    id: 'scan',
    name: 'SCAN',
    role: 'Code Reviewer',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-sonnet-4-6',
    description:
      "Code review and QA. Reviews code for correctness, security, and quality. Read-only perspective check on RICK's code.",
    parameters: { ...SCAN_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'product',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'execute_bash',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'delv',
    name: 'DELV',
    role: 'Researcher',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-haiku-4-5',
    description:
      'Research lead. Web research, competitive analysis, codebase exploration, and evidence gathering.',
    parameters: { ...DELV_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'product',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'call_external_apis',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'trek',
    name: 'TREK',
    role: 'Career',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-haiku-4-5',
    description: 'Career strategy. Networking, skill development, and professional positioning.',
    parameters: { ...TREK_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'personal',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'call_external_apis',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'echo',
    name: 'ECHO',
    role: 'Brand',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-haiku-4-5',
    description: 'Personal brand. Social media, thought leadership, and public-facing content.',
    parameters: { ...ECHO_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'personal',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'call_external_apis',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'bond',
    name: 'BOND',
    role: 'Relationships',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-haiku-4-5',
    description: 'Relationship management. CRM, follow-ups, and professional relationship mapping.',
    parameters: { ...BOND_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'personal',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'vita',
    name: 'VITA',
    role: 'Growth',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-haiku-4-5',
    description: 'Personal growth. Goal tracking, habits, wellness, and life admin.',
    parameters: { ...VITA_DEFAULTS },
    activeProfile: 'default',
    depth: 2,
    pod: 'personal',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
  {
    id: 'ward',
    name: 'WARD',
    role: 'Guardian',
    type: 'ai',
    tier: 'head',
    status: 'standby',
    model: 'claude-sonnet-4-6',
    description:
      'Guardian agent. Continuous quality enforcement across code, performance, design system compliance, security, and polish. Always watching.',
    parameters: { ...WARD_DEFAULTS },
    activeProfile: 'default',
    depth: 1,
    pod: 'product',
    permissions: [
      'read_vault',
      'write_vault',
      'create_tasks',
      'update_tasks',
      'execute_bash',
      'read_memory',
      'write_memory',
      'call_claude',
    ],
  },
];

export function getAgent(id: string): Agent | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Returns a plain string[] of all agent IDs. Use this instead of iterating AGENTS directly. */
export function getAgentIds(): string[] {
  return AGENTS.map((a) => a.id);
}

export { AGENT_COLORS, getAgentColor, type AgentColor } from './agent-colors';
