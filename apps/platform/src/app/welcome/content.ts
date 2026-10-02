import { SALES_EMAIL } from '@/lib/branding';

/**
 * Welcome / landing page content configuration.
 *
 * All marketing copy is centralized here so messaging can be iterated
 * without touching component code.
 */

export const welcomeContent = {
  badge: 'Now in early access',

  hero: {
    heading: 'Your second brain',
    headingAccent: 'for work',
    description:
      'AI agents that know your context, manage your tasks, and grow smarter with every interaction. Built for builders who think in systems.',
  },

  cta: {
    primary: 'Get started',
    waitlistPlaceholder: 'Or join the waitlist',
    waitlistButton: 'Join',
    successMessage: "You're on the list. We'll be in touch.",
  },

  features: [
    {
      icon: 'Bot' as const,
      iconColor: 'text-purple-400',
      title: 'Agent Lead',
      description:
        'A personalized AI agent that knows your role, goals, and working style. It manages tasks, not just answers questions.',
    },
    {
      icon: 'Brain' as const,
      iconColor: 'text-blue-400',
      title: 'Persistent Memory',
      description:
        'Your agent remembers everything — past decisions, preferences, context. Semantic search across your entire knowledge base.',
    },
    {
      icon: 'Shield' as const,
      iconColor: 'text-green-400',
      title: 'MCP Connected',
      description:
        'Plug into Claude Code, Cursor, or any MCP client. Your tasks and memory follow you wherever you work.',
    },
  ],

  pricing: {
    heading: 'Simple pricing',
    subtitle: 'One plan, priced per seat. Agents are free. Bring your own model keys.',
    tiers: [
      {
        name: 'Celune Cloud',
        price: '$25',
        priceSuffix: '/seat/mo',
        highlighted: true,
        features: ['$20/seat/mo billed annually', 'Unlimited agents', 'Unlimited workspaces'],
      },
      {
        name: 'Enterprise',
        price: 'Custom',
        priceSuffix: '',
        highlighted: false,
        features: ['Custom terms', 'Dedicated contract', `Contact ${SALES_EMAIL}`],
      },
    ],
  },

  footer: 'Celune — Your second brain for work',
} as const;

export type WelcomeContent = typeof welcomeContent;
