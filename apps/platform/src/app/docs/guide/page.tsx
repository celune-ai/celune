import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { SALES_EMAIL } from '@/lib/branding';

export const metadata: Metadata = {
  title: 'Celune Guide',
  description: 'Get started with Celune — your second brain for work',
};

const sections = [
  {
    title: 'Getting Started',
    items: [
      {
        title: 'What is Celune?',
        content:
          'Celune is an AI-powered second brain that combines task management, persistent memory, and intelligent agents. Your Agent Lead knows your role, goals, and working style — it manages work, not just answers questions.',
      },
      {
        title: 'Creating your Agent Lead',
        content:
          "When you first sign up, you'll name your Agent Lead, choose its archetype (Strategist, Analyst, Coach, Builder, Connector, or Guardian), select a voice, and pick a color. The archetype shapes how your agent thinks and communicates.",
      },
      {
        title: 'Your first 30 minutes',
        content:
          'After onboarding, you\'ll see two projects: "Getting Started with Celune" (8 tutorial tasks) and a personalized Goal Project based on your answers. Start with Task 1 — claim it and mark it complete to learn the task lifecycle.',
      },
    ],
  },
  {
    title: 'Connecting Your AI Tools',
    items: [
      {
        title: 'Universal Installer (Recommended)',
        content:
          'Run "npx @celuneai/cli" in your terminal. It auto-detects your installed AI tools (Claude Code, Cursor, Windsurf, Cline), authenticates via browser, and configures MCP for all of them in one step. Run "celune status" to verify.',
      },
      {
        title: 'Claude Code',
        content:
          'Go to Settings → API Keys → Create a new key. Select the "Claude Code" tab and copy the CLI command. Run it in your terminal to connect via MCP. Config is stored in ~/.claude.json.',
      },
      {
        title: 'Cursor',
        content:
          'Create an API key in Settings, then select the "Cursor" tab. Copy the JSON config and add it to ~/.cursor/mcp.json. Restart Cursor to activate.',
      },
      {
        title: 'Windsurf',
        content:
          'Create an API key in Settings, then select the "Windsurf" tab. Copy the JSON config and add it to ~/.codeium/windsurf/mcp_config.json. Restart Windsurf to activate.',
      },
      {
        title: 'Cline (VS Code)',
        content:
          'Create an API key in Settings, then select the "Cline" tab. Copy the JSON config and add it to .vscode/cline_mcp_settings.json in your project directory. This is a project-level config.',
      },
      {
        title: 'Available MCP Tools',
        content:
          'Once connected, you can use: list_tasks, get_task, create_task, claim_task, complete_task, block_task, add_comment, list_projects, get_project, recall_memory, store_memory, and whoami — all from your coding environment.',
      },
      {
        title: 'Project-level sharing',
        content:
          "Add Celune to your project's .mcp.json file to share the connection with your team. Store your API key in an environment variable (CELUNE_API_KEY) for security.",
      },
    ],
  },
  {
    title: 'Core Concepts',
    items: [
      {
        title: 'Tasks',
        content:
          'Tasks follow a lifecycle: inbox → in_progress → done. Each task has a title, description, priority, and optional project assignment. You can claim tasks, add comments, block them with a reason, and record outcomes when completing.',
      },
      {
        title: 'Projects',
        content:
          'Projects group related tasks. They can be features, plans, or learning paths. Project groups (like sprints or initiatives) organize projects at a higher level.',
      },
      {
        title: 'Memory',
        content:
          'Your agent stores memories in categories: context (role, goals), preferences (working style), decisions, facts, and episodes. Memories are searchable via semantic search — your agent recalls relevant context automatically.',
      },
      {
        title: 'Workspaces',
        content:
          'Workspaces separate different contexts (e.g., personal vs. work). Each workspace has its own tasks, projects, agents, and memory. Switch between workspaces from the sidebar.',
      },
    ],
  },
  {
    title: 'Plans & Billing',
    items: [
      {
        title: 'Celune Cloud ($25/seat/mo)',
        content:
          '$20 per seat per month billed annually. A seat is an active organization member; agents are free. Unlimited agents, workspaces, and memories. Bring your own model keys.',
      },
      {
        title: 'Enterprise (custom)',
        content: `Custom terms or a dedicated contract. Contact ${SALES_EMAIL}.`,
      },
    ],
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="border-b border-white/5 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/welcome" className="text-white/50 transition-colors hover:text-white">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2">
              <Image
                src="/celune-logomark.svg"
                alt="Celune"
                className="h-5 w-auto"
                width={20}
                height={20}
                unoptimized
              />
              <span className="text-sm font-semibold">Celune Guide</span>
            </div>
          </div>
          <Link
            href="/signup"
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="mb-2 text-4xl font-bold">Celune Guide</h1>
        <p className="mb-12 text-lg text-white/50">Everything you need to get started.</p>

        <div className="space-y-16">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="mb-6 text-2xl font-bold">{section.title}</h2>
              <div className="space-y-6">
                {section.items.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
                  >
                    <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-white/60">{item.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-white/5 px-6 py-8 text-center text-xs text-white/30">
        Celune — Your second brain for work
      </footer>
    </div>
  );
}
