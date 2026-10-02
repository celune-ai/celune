'use client';

import {
  AlertTriangle,
  Github,
  MessageSquare,
  Brain,
  Plug,
  Database,
  Cloud,
  Palette,
  Mail,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@repo/ui/components/badge';

interface PreviewIntegration {
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
}

const PREVIEW_CATEGORIES: { label: string; integrations: PreviewIntegration[] }[] = [
  {
    label: 'Source Control',
    integrations: [
      {
        name: 'GitHub',
        description: 'Source control, pull requests, and CI/CD.',
        icon: Github,
        category: 'source_control',
      },
      {
        name: 'GitLab',
        description: 'Git repositories and merge requests.',
        icon: Github,
        category: 'source_control',
      },
      {
        name: 'Bitbucket',
        description: 'Atlassian-hosted Git repos.',
        icon: Github,
        category: 'source_control',
      },
    ],
  },
  {
    label: 'AI Providers',
    integrations: [
      {
        name: 'Anthropic',
        description: 'Claude models for AI agents.',
        icon: Brain,
        category: 'ai_provider',
      },
      {
        name: 'OpenAI',
        description: 'GPT models and transcription.',
        icon: Brain,
        category: 'ai_provider',
      },
      {
        name: 'Google Gemini',
        description: 'Gemini models for AI agents.',
        icon: Brain,
        category: 'ai_provider',
      },
    ],
  },
  {
    label: 'Communication',
    integrations: [
      {
        name: 'Slack',
        description: 'Team notifications and slash commands.',
        icon: MessageSquare,
        category: 'communication',
      },
      {
        name: 'Discord',
        description: 'Notifications in your Discord server.',
        icon: MessageSquare,
        category: 'communication',
      },
      {
        name: 'Microsoft Teams',
        description: 'Notifications in Teams channels.',
        icon: MessageSquare,
        category: 'communication',
      },
    ],
  },
  {
    label: 'Project Management',
    integrations: [
      {
        name: 'Linear',
        description: 'Issue tracking for engineering teams.',
        icon: BarChart3,
        category: 'project_management',
      },
      {
        name: 'Jira',
        description: 'Enterprise project management.',
        icon: BarChart3,
        category: 'project_management',
      },
      {
        name: 'Notion',
        description: 'Docs, wikis, and knowledge base.',
        icon: BarChart3,
        category: 'project_management',
      },
    ],
  },
  {
    label: 'Infrastructure',
    integrations: [
      {
        name: 'Supabase',
        description: 'Database, auth, and real-time.',
        icon: Database,
        category: 'databases',
      },
      {
        name: 'Vercel',
        description: 'Hosting and edge functions.',
        icon: Cloud,
        category: 'deployment',
      },
      { name: 'AWS', description: 'Cloud compute and storage.', icon: Cloud, category: 'cloud' },
    ],
  },
  {
    label: 'More',
    integrations: [
      {
        name: 'Figma',
        description: 'Design files and prototypes.',
        icon: Palette,
        category: 'design',
      },
      {
        name: 'Resend',
        description: 'Transactional email delivery.',
        icon: Mail,
        category: 'email',
      },
      {
        name: 'Sentry',
        description: 'Error tracking and monitoring.',
        icon: AlertTriangle,
        category: 'monitoring',
      },
    ],
  },
];

export function IntegrationsComingSoon() {
  return (
    <div className="space-y-8">
      {/* Alert banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <Plug className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div>
          <h3 className="text-foreground text-sm font-medium">
            Integration Hub — Coming This Quarter
          </h3>
          <p className="text-foreground-lighter mt-1 text-sm leading-relaxed">
            Connect your favorite tools directly to Celune. Your agents will be able to interact
            with source control, project management, communication, AI providers, and more — all
            from one place.
          </p>
        </div>
      </div>

      {/* Preview header */}
      <div>
        <h2 className="text-foreground text-xl font-semibold">Integrations</h2>
        <p className="text-foreground-muted mt-1 text-sm">
          60+ integrations across 20 categories — launching soon.
        </p>
      </div>

      {/* Preview grid with fade */}
      <div className="relative">
        <div className="space-y-8">
          {PREVIEW_CATEGORIES.map((category) => (
            <div key={category.label}>
              <h3 className="text-foreground-lighter mb-3 text-xs font-medium tracking-wider uppercase">
                {category.label}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {category.integrations.map((integration) => (
                  <div
                    key={integration.name}
                    className="border-border bg-surface-75 flex items-start gap-3 rounded-lg border p-4"
                  >
                    <div className="bg-surface-200 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                      <integration.icon className="text-foreground-muted h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-foreground text-sm font-medium">{integration.name}</h4>
                        <Badge variant="muted" className="text-[10px]">
                          Coming Soon
                        </Badge>
                      </div>
                      <p className="text-foreground-lighter mt-0.5 text-xs leading-relaxed">
                        {integration.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Fade-out gradient at bottom */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[var(--color-background)] to-transparent" />
      </div>
    </div>
  );
}
