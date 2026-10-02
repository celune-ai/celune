/**
 * Team-specific starter memories for onboarding.
 *
 * Maps each TeamCategory to curated best-practice memories that are seeded
 * when a user creates agent teams during onboarding.
 */
import type { TeamCategory } from './team-templates';

export interface StarterMemory {
  key: string;
  content: string;
  category: 'preference' | 'decision' | 'context' | 'fact' | 'general';
  memory_type: string;
  importance_score: number;
}

// ---------------------------------------------------------------------------
// Per-category starter memories
// ---------------------------------------------------------------------------

const SOFTWARE_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:code-review',
    content:
      'Code reviews should focus on correctness, security, and maintainability — not style preferences. Automate style with formatters and linters.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:testing-strategy',
    content:
      'Test at the right level: unit tests for logic, integration tests for API boundaries, E2E tests for critical user flows. Aim for confidence, not coverage percentages.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:incremental-delivery',
    content:
      'Ship small, incremental changes over large batches. Each PR should be reviewable in under 30 minutes. Break large features into vertical slices.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:api-design',
    content:
      'Design APIs contract-first. Validate all inputs at boundaries. Return consistent error shapes. Version breaking changes.',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:security-defaults',
    content:
      'Security defaults: validate all user input, use parameterized queries, enforce auth at every endpoint, never log secrets, enable RLS on all tables.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.9,
  },
  {
    key: 'best-practice:tech-debt',
    content:
      'Track technical debt explicitly. Allocate ~20% of sprint capacity to debt reduction. Fix it when you touch the code, not in dedicated "cleanup sprints".',
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.6,
  },
];

const MARKETING_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:ai-content-strategy',
    content:
      'Use AI to generate content drafts and variations, but always have a human review for brand voice, accuracy, and authenticity. AI excels at scale; humans excel at nuance.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:funnel-metrics',
    content:
      'Track the full funnel: awareness (impressions, reach) → interest (clicks, engagement) → consideration (signups, trials) → conversion (purchases) → retention (churn, LTV).',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:audience-first',
    content:
      'Start with audience research before creating content. Understand pain points, language, and channels. The best campaign targets a specific persona, not "everyone".',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:seo-fundamentals',
    content:
      'SEO basics: target long-tail keywords, write for humans first, optimize meta descriptions, build internal links, create content clusters around pillar topics.',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:campaign-testing',
    content:
      'A/B test one variable at a time. Run tests for statistical significance (minimum 100 conversions per variant). Document learnings for future campaigns.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:brand-consistency',
    content:
      'Maintain brand voice across all channels. Create a brand guide with tone, vocabulary, visual standards, and messaging pillars. Every touchpoint reinforces the brand.',
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.6,
  },
];

const CONTENT_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:content-calendar',
    content:
      'Plan content 2-4 weeks ahead with a shared calendar. Include topic, format, channel, publish date, and owner. Leave room for timely/reactive content.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:content-repurposing',
    content:
      'Repurpose every piece of long-form content into 3-5 derivative formats: blog → social posts → email snippet → video script → infographic. Maximize ROI per idea.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:editorial-workflow',
    content:
      'Use a clear editorial workflow: ideation → outline → draft → review → edit → publish → distribute. Each stage has a clear owner and quality bar.',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:audience-engagement',
    content:
      "Engage with your audience in comments and DMs. Respond within 24 hours. Community building is a moat that algorithms can't replicate.",
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:content-analytics',
    content:
      "Track content performance weekly: views, engagement rate, shares, time on page, conversion rate. Double down on what works; retire what doesn't after 3 attempts.",
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
];

const BUSINESS_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:okr-framework',
    content:
      'Set quarterly OKRs: 3-5 objectives with 2-3 measurable key results each. Review weekly, adjust monthly. Ambitious but achievable (70% hit rate is healthy).',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:stakeholder-communication',
    content:
      'Communicate up and out proactively. Weekly status updates, monthly metrics reviews, quarterly strategy check-ins. Bad news travels faster when you control the narrative.',
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:decision-framework',
    content:
      'For major decisions: define the decision clearly, list options with tradeoffs, set a deadline, assign a DRI (directly responsible individual). Reversible decisions should be made fast.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:financial-hygiene',
    content:
      'Track burn rate monthly. Know your runway. Revenue recognition follows delivery, not invoicing. Maintain 6+ months of runway at all times.',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:competitive-intelligence',
    content:
      'Monitor competitors quarterly: pricing changes, feature launches, hiring patterns, funding rounds. Build a competitive matrix. React to trends, not individual moves.',
    category: 'context',
    memory_type: 'context',
    importance_score: 0.6,
  },
];

const CREATIVE_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:design-system',
    content:
      'Build and maintain a design system: tokens (colors, spacing, typography), components (buttons, inputs, cards), patterns (navigation, forms, data display). Consistency scales.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:user-research',
    content:
      'Validate designs with real users before engineering commits to building. 5 user tests catch 80% of usability issues. Test prototypes, not wireframes.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:accessibility',
    content:
      "Design for accessibility from the start: color contrast ratios (4.5:1 minimum), keyboard navigation, screen reader labels, focus indicators. It's easier to build accessible than to retrofit.",
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:creative-feedback',
    content:
      'Give specific, actionable design feedback. "Make the CTA more prominent" is better than "I don\'t like it." Reference design principles, not personal preferences.',
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:asset-management',
    content:
      'Organize creative assets in a shared library with consistent naming, version control, and usage guidelines. Tag by campaign, format, and status (draft/approved/archived).',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.6,
  },
];

const OPERATIONS_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:process-documentation',
    content:
      'Document every repeatable process. If it happens more than twice, it needs a playbook. Include: trigger, steps, owner, escalation path, and expected outcome.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:incident-response',
    content:
      'Have an incident response plan: detect → triage → communicate → fix → post-mortem. Blameless post-mortems within 48 hours. Track action items to completion.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:automation-priority',
    content:
      'Automate the highest-volume, lowest-complexity tasks first. If a human does it 10+ times per week and it follows clear rules, automate it.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:vendor-management',
    content:
      'Review vendor contracts annually. Track usage vs. cost. Negotiate before auto-renewal. Maintain a backup vendor for critical services.',
    category: 'context',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:team-capacity',
    content:
      'Plan at 70-80% capacity to absorb unexpected work. 100% utilization means zero ability to handle emergencies or innovate.',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
];

const PROFESSIONAL_SERVICES_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:client-communication',
    content:
      "Send weekly client updates: what was done, what's next, any blockers. Over-communicate rather than under-communicate. Set expectations early and often.",
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'best-practice:scope-management',
    content:
      'Define scope clearly in writing before starting. When scope changes, document it, get sign-off, and adjust timeline/budget. Scope creep kills profitability.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.9,
  },
  {
    key: 'best-practice:knowledge-capture',
    content:
      "After every client engagement, capture learnings: what worked, what didn't, reusable templates, domain insights. Build an internal knowledge base that compounds.",
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:time-tracking',
    content:
      'Track time daily, not weekly. Categorize by: client work, internal projects, admin, learning. Use data to price future engagements accurately.',
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:deliverable-quality',
    content:
      'Every deliverable gets an internal review before client delivery. Use a checklist: completeness, accuracy, formatting, alignment with brief, free of errors.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.7,
  },
];

const PERSONAL_MEMORIES: StarterMemory[] = [
  {
    key: 'best-practice:goal-setting',
    content:
      'Set goals at three horizons: daily (3 priorities), weekly (key outcomes), quarterly (strategic objectives). Review weekly and adjust. Written goals are 42% more likely to be achieved.',
    category: 'fact',
    memory_type: 'context',
    importance_score: 0.7,
  },
  {
    key: 'best-practice:habit-stacking',
    content:
      'Build new habits by stacking them onto existing routines. "After [existing habit], I will [new habit]." Start with 2-minute versions and scale up.',
    category: 'context',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:energy-management',
    content:
      'Schedule high-concentration work during your peak energy hours. Protect those blocks. Use low-energy periods for admin, email, and routine tasks.',
    category: 'preference',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:learning-system',
    content:
      'Active learning beats passive consumption. For every hour of reading/watching, spend 30 minutes applying, teaching, or writing about what you learned.',
    category: 'decision',
    memory_type: 'context',
    importance_score: 0.6,
  },
  {
    key: 'best-practice:network-cultivation',
    content:
      'Nurture your professional network proactively. Reach out to 2-3 contacts per week. Offer value before asking. Track relationships and follow up consistently.',
    category: 'context',
    memory_type: 'context',
    importance_score: 0.5,
  },
];

// ---------------------------------------------------------------------------
// Registry and seeding
// ---------------------------------------------------------------------------

export const STARTER_MEMORY_REGISTRY: Record<TeamCategory, StarterMemory[]> = {
  software: SOFTWARE_MEMORIES,
  marketing: MARKETING_MEMORIES,
  content: CONTENT_MEMORIES,
  business: BUSINESS_MEMORIES,
  creative: CREATIVE_MEMORIES,
  operations: OPERATIONS_MEMORIES,
  'professional-services': PROFESSIONAL_SERVICES_MEMORIES,
  personal: PERSONAL_MEMORIES,
};

/**
 * Get deduplicated starter memories for a set of team categories.
 * Deduplicates by memory key across overlapping categories.
 */
export function getStarterMemoriesForTeams(categories: TeamCategory[]): StarterMemory[] {
  const seen = new Set<string>();
  const result: StarterMemory[] = [];

  for (const cat of categories) {
    const memories = STARTER_MEMORY_REGISTRY[cat] ?? [];
    for (const mem of memories) {
      if (!seen.has(mem.key)) {
        seen.add(mem.key);
        result.push(mem);
      }
    }
  }

  return result;
}
