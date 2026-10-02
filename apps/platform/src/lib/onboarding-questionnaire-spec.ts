import { PLAN_TIERS } from '@repo/types';
import type { Plan } from '@repo/types';

/**
 * Onboarding Questionnaire Spec
 *
 * Defines the 7-question flow that customizes a user's second brain package.
 * Each answer maps to specific brain configuration (skills, hooks, agents, delegation mode).
 *
 * Flow: One question per screen, card selection or multi-select (no free text except Q1-Q2).
 * Progressive: Q6-Q7 only shown based on previous answers.
 * Target: <3 minutes, >85% completion rate.
 *
 * Current state (context-qa-wizard.tsx): 3 questions (role, priority, autonomy).
 * This spec expands to 7 questions with structured mapping to brain config.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionType = 'card-select' | 'multi-select' | 'text-input' | 'slider';

export interface QuestionOption {
  value: string;
  label: string;
  description: string;
  icon?: string; // Lucide icon name
}

export interface OnboardingQuestion {
  id: string;
  /** Display order (1-indexed) */
  order: number;
  /** Question text shown to user */
  question: string;
  /** Subtitle/context for the question */
  subtitle?: string;
  /** Input type */
  type: QuestionType;
  /** Available options (for card-select and multi-select) */
  options: QuestionOption[];
  /** Max selections (for multi-select) */
  maxSelections?: number;
  /** Whether this question is always shown or conditional */
  condition?: (answers: Record<string, string | string[]>) => boolean;
  /** Placeholder text (for text-input type) */
  placeholder?: string;
  /** Memory category for storage */
  memoryCategory: 'context' | 'preference';
}

// ---------------------------------------------------------------------------
// Brain Config Mapping
// ---------------------------------------------------------------------------

export interface BrainConfig {
  /** Which skill categories to enable */
  skillCategories: string[];
  /** Which hooks to enable by default */
  enabledHooks: string[];
  /** Agent archetype selection */
  agentArchetypes: string[];
  /** Max agent count (from plan tier) */
  maxAgents: number;
  /** Delegation mode */
  delegationMode: 'solo' | 'supervised' | 'autonomous' | 'team';
  /** TDD enforcement level */
  tddEnforcement: 'off' | 'advisory' | 'strict';
  /** Notification channels */
  notifications: string[];
}

/**
 * Maps questionnaire answers to brain configuration.
 * Called after all questions are answered.
 */
export function mapAnswersToBrainConfig(
  answers: Record<string, string | string[]>,
  planTier: Plan,
): BrainConfig {
  const useCase = answers['use-case'] as string;
  const teamSize = answers['team-size'] as string;
  const techStack = (answers['tech-stack'] as string[]) ?? [];
  const autonomy = answers['autonomy'] as string;
  const tdd = (answers['tdd-preference'] as string) ?? 'advisory';
  const notifs = (answers['notifications'] as string[]) ?? ['in-app'];

  // Agent count from the plan (no plan caps agents today)
  const maxAgents = (PLAN_TIERS[planTier] ?? PLAN_TIERS.cloud).max_agents ?? 999;

  // Delegation mode from autonomy + team size
  let delegationMode: BrainConfig['delegationMode'] = 'supervised';
  if (autonomy === 'autonomous') delegationMode = 'autonomous';
  else if (autonomy === 'solo') delegationMode = 'solo';
  else if (teamSize === 'large' || teamSize === 'growing') delegationMode = 'team';

  // Skills from use case + tech stack
  const skillCategories: string[] = ['debugging', 'context-management'];
  if (useCase === 'web-app' || useCase === 'fullstack') {
    skillCategories.push('code-review', 'tdd', 'worktree-workflow');
  }
  if (useCase === 'content' || useCase === 'marketing') {
    skillCategories.push('research', 'brain');
  }
  if (useCase === 'ai-ml') {
    skillCategories.push('tdd', 'research');
  }
  if (techStack.includes('react') || techStack.includes('nextjs')) {
    skillCategories.push('build', 'deep-build');
  }

  // Hooks from use case
  const enabledHooks: string[] = ['session-start', 'auto-format'];
  enabledHooks.push('dependency-verification');
  if (tdd === 'strict' || (tdd === 'advisory' && useCase === 'web-app')) {
    enabledHooks.push('tdd-enforcement');
  }

  // Agent archetypes from use case
  const agentArchetypes: string[] = ['lead-coder', 'code-reviewer'];
  if (maxAgents >= 5) {
    if (useCase === 'web-app' || useCase === 'fullstack' || useCase === 'mobile') {
      agentArchetypes.push('pm', 'designer', 'researcher');
    } else if (useCase === 'content' || useCase === 'marketing') {
      agentArchetypes.push('pm', 'researcher', 'brand');
    } else if (useCase === 'ai-ml') {
      agentArchetypes.push('pm', 'researcher', 'analyst');
    } else {
      agentArchetypes.push('pm', 'designer', 'researcher');
    }
  }

  return {
    skillCategories,
    enabledHooks,
    agentArchetypes,
    maxAgents,
    delegationMode,
    tddEnforcement: tdd as BrainConfig['tddEnforcement'],
    notifications: notifs as string[],
  };
}

// ---------------------------------------------------------------------------
// Question Definitions
// ---------------------------------------------------------------------------

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  // Q1: Use Case (always shown)
  {
    id: 'use-case',
    order: 1,
    question: 'What are you building?',
    subtitle: 'This shapes which skills and agents we set up for you.',
    type: 'card-select',
    options: [
      {
        value: 'web-app',
        label: 'Web Application',
        description: 'React, Next.js, full-stack web apps',
        icon: 'Globe',
      },
      {
        value: 'mobile',
        label: 'Mobile App',
        description: 'React Native, Flutter, iOS/Android',
        icon: 'Smartphone',
      },
      {
        value: 'ai-ml',
        label: 'AI / ML / Data',
        description: 'Models, pipelines, data analysis',
        icon: 'Brain',
      },
      {
        value: 'content',
        label: 'Content & Writing',
        description: 'Blog, docs, marketing copy, newsletters',
        icon: 'PenTool',
      },
      {
        value: 'fullstack',
        label: 'Infrastructure & DevOps',
        description: 'APIs, deployment, CI/CD, cloud',
        icon: 'Server',
      },
      {
        value: 'other',
        label: 'Something Else',
        description: "I'll customize as I go",
        icon: 'Sparkles',
      },
    ],
    memoryCategory: 'context',
  },

  // Q2: Role context (always shown, free text)
  {
    id: 'role',
    order: 2,
    question: 'What are you most responsible for right now?',
    subtitle: 'This helps your agent understand your context.',
    type: 'text-input',
    options: [],
    placeholder: 'e.g., Leading product development for a SaaS startup...',
    memoryCategory: 'context',
  },

  // Q3: Team Size (always shown)
  {
    id: 'team-size',
    order: 3,
    question: 'Who are you building with?',
    subtitle: 'This determines how many AI agents you get.',
    type: 'card-select',
    options: [
      {
        value: 'solo',
        label: 'Just me',
        description: 'Solo developer or indie hacker',
        icon: 'User',
      },
      {
        value: 'small',
        label: 'Small team (2-5)',
        description: 'Tight-knit team, fast iteration',
        icon: 'Users',
      },
      {
        value: 'growing',
        label: 'Growing team (6-15)',
        description: 'Scaling up, need coordination',
        icon: 'UserPlus',
      },
      {
        value: 'large',
        label: 'Large team (15+)',
        description: 'Enterprise, multiple squads',
        icon: 'Building',
      },
    ],
    memoryCategory: 'context',
  },

  // Q4: Tech Stack (always shown, multi-select)
  {
    id: 'tech-stack',
    order: 4,
    question: "What's in your stack?",
    subtitle: "Pick up to 3. We'll tailor skills and hooks to match.",
    type: 'multi-select',
    maxSelections: 3,
    options: [
      { value: 'react', label: 'React', description: 'React, Next.js, Remix' },
      { value: 'vue', label: 'Vue', description: 'Vue, Nuxt' },
      { value: 'svelte', label: 'Svelte', description: 'Svelte, SvelteKit' },
      { value: 'nodejs', label: 'Node.js', description: 'Express, Fastify, Hono' },
      { value: 'python', label: 'Python', description: 'Django, FastAPI, Flask' },
      { value: 'typescript', label: 'TypeScript', description: 'Full-stack TS' },
      { value: 'go', label: 'Go', description: 'Go services, CLI tools' },
      { value: 'rust', label: 'Rust', description: 'Systems, WASM, CLI' },
      { value: 'postgres', label: 'PostgreSQL', description: 'Supabase, raw SQL' },
      { value: 'docker', label: 'Docker / K8s', description: 'Containers, orchestration' },
      { value: 'mobile-rn', label: 'React Native', description: 'Cross-platform mobile' },
      { value: 'other-stack', label: 'Other', description: 'Something not listed' },
    ],
    memoryCategory: 'preference',
  },

  // Q5: Autonomy (always shown)
  {
    id: 'autonomy',
    order: 5,
    question: 'How do you want your agents to work?',
    subtitle: 'You can change this anytime in settings.',
    type: 'card-select',
    options: [
      {
        value: 'solo',
        label: 'I drive',
        description: 'Agents suggest, I decide and execute',
        icon: 'MousePointer',
      },
      {
        value: 'supervised',
        label: 'Co-pilot',
        description: 'Agents act but check with me on important decisions',
        icon: 'Handshake',
      },
      {
        value: 'autonomous',
        label: 'Autopilot',
        description: 'Agents handle tasks end-to-end, I review results',
        icon: 'Zap',
      },
    ],
    memoryCategory: 'preference',
  },

  // Q6: TDD Preference (conditional — shown for web-app, fullstack, ai-ml)
  {
    id: 'tdd-preference',
    order: 6,
    question: 'How strict should testing be?',
    subtitle: 'Controls whether agents auto-generate tests.',
    type: 'card-select',
    options: [
      {
        value: 'off',
        label: 'Off',
        description: "I'll handle testing myself",
        icon: 'Circle',
      },
      {
        value: 'advisory',
        label: 'Advisory',
        description: "Suggest tests, don't enforce",
        icon: 'MessageCircle',
      },
      {
        value: 'strict',
        label: 'Strict',
        description: 'Tests required for all core logic',
        icon: 'ShieldCheck',
      },
    ],
    condition: (answers) => {
      const useCase = answers['use-case'] as string;
      return ['web-app', 'fullstack', 'ai-ml', 'mobile'].includes(useCase);
    },
    memoryCategory: 'preference',
  },

  // Q7: Notifications (conditional — shown for teams)
  {
    id: 'notifications',
    order: 7,
    question: 'How should we keep you in the loop?',
    subtitle: 'Choose one or more.',
    type: 'multi-select',
    maxSelections: 3,
    options: [
      {
        value: 'in-app',
        label: 'In-app only',
        description: 'Dashboard notifications',
        icon: 'Bell',
      },
      {
        value: 'slack',
        label: 'Slack',
        description: 'Post updates to a channel',
        icon: 'Hash',
      },
      {
        value: 'email',
        label: 'Email digest',
        description: 'Weekly summary email',
        icon: 'Mail',
      },
    ],
    condition: (answers) => {
      const teamSize = answers['team-size'] as string;
      return teamSize !== 'solo';
    },
    memoryCategory: 'preference',
  },
];

/**
 * Returns only the questions that should be shown, given current answers.
 */
export function getVisibleQuestions(
  answers: Record<string, string | string[]>,
): OnboardingQuestion[] {
  return ONBOARDING_QUESTIONS.filter((q) => !q.condition || q.condition(answers));
}

/**
 * Returns a preview of what the brain will include based on current answers.
 * Shown as chips before final submit.
 */
export function getBrainPreview(
  answers: Record<string, string | string[]>,
): { label: string; category: 'skill' | 'hook' | 'agent' | 'setting' }[] {
  const preview: { label: string; category: 'skill' | 'hook' | 'agent' | 'setting' }[] = [];
  const useCase = answers['use-case'] as string;
  const autonomy = answers['autonomy'] as string;

  // Skills
  preview.push({ label: 'Debugging', category: 'skill' });
  preview.push({ label: 'Context Management', category: 'skill' });
  if (['web-app', 'fullstack', 'mobile'].includes(useCase)) {
    preview.push({ label: 'Code Review', category: 'skill' });
    preview.push({ label: 'TDD', category: 'skill' });
  }
  if (['content', 'marketing'].includes(useCase)) {
    preview.push({ label: 'Research', category: 'skill' });
  }

  // Hooks
  preview.push({ label: 'Session Start', category: 'hook' });
  preview.push({ label: 'Auto Format', category: 'hook' });

  // Agents
  preview.push({ label: 'Lead Coder', category: 'agent' });
  preview.push({ label: 'Code Reviewer', category: 'agent' });

  // Settings
  if (autonomy === 'autonomous') {
    preview.push({ label: 'Autopilot Mode', category: 'setting' });
  }

  return preview;
}
