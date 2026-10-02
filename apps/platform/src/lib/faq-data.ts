import { SALES_EMAIL, URL_DOCS, URL_STATUS } from '@/lib/branding';

export interface FaqItem {
  q: string;
  a: string;
  docsHref?: string;
  docsLabel?: string;
}

export interface FaqCategory {
  id: string;
  label: string;
  items: FaqItem[];
}

/**
 * Single source of truth for FAQ data.
 * Used by both the Help Center page and the support chat system prompt.
 *
 * IMPORTANT: Keep pricing info in sync with PLAN_TIERS, PLAN_PRICES, and
 * CLOUD_SEAT_PRICE_USD in @repo/types. Those drive the billing UI;
 * this file drives the support bot and help center.
 *
 * Note: `icon` is intentionally omitted here — the Help Center page
 * maps icons by category ID since Lucide icons are React components
 * and this module must stay importable on the server.
 */
export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: 'account',
    label: 'Account & Setup',
    items: [
      {
        q: 'How do I create my first workspace?',
        a: 'After signing up, you are automatically given a personal workspace. To create additional workspaces, go to Settings → Workspaces and click "New Workspace". Each workspace has its own agents, projects, tasks, and billing.',
        docsHref: `${URL_DOCS}/workspaces`,
        docsLabel: 'Workspace docs',
      },
      {
        q: 'How do I invite team members?',
        a: 'Navigate to Settings → Users and click "Invite Member". Enter their email and select a role. They will receive an invitation email. Roles: Viewer (read-only), Member (create/edit tasks), Admin (manage workspace), Owner (full control including billing).',
        docsHref: `${URL_DOCS}/roles`,
        docsLabel: 'Roles & permissions',
      },
      {
        q: 'How do I change my password or email?',
        a: 'Go to Settings → Account. You can update your email and reset your password there.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Go to Settings → Account → Danger Zone. If you are an owner of a workspace, you must transfer ownership or delete the workspace before deleting your account. Account deletion is permanent and cannot be undone.',
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      {
        q: 'How do I create and configure an agent?',
        a: 'Navigate to Team → New Agent. Give it a name, optionally assign it a persona, and configure its tools and capabilities. Agents can be assigned tasks, connected to MCP servers, and given workspace-scoped access to your data.',
        docsHref: `${URL_DOCS}/agents`,
        docsLabel: 'Agent documentation',
      },
      {
        q: 'What is an MCP connection?',
        a: 'Model Context Protocol (MCP) lets your agents connect to external tools and data sources — like GitHub, databases, Slack, and more. Go to Settings → MCP Connections to add a server. Each agent can subscribe to any configured MCP connections.',
        docsHref: `${URL_DOCS}/mcp`,
        docsLabel: 'MCP guide',
      },
      {
        q: 'Why is my agent not responding?',
        a: "Check the Activity Feed for error events. Common causes: (1) The agent has no active session, (2) An MCP connection is offline, (3) You have hit your plan's agent call limit. Check Settings → Usage to see your current consumption.",
      },
      {
        q: 'Can agents run autonomously overnight?',
        a: 'Yes. Agents with the overnight auto-approve flag set will execute tasks without human confirmation. You can configure this per-agent and set time windows. The platform enforces mandatory code review tasks before any overnight session closes.',
      },
    ],
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    items: [
      {
        q: 'Where do I find my API keys?',
        a: 'Go to Settings → API Keys. You can create scoped API keys with read or write access. Each key is tied to a workspace. Never share your secret key — treat it like a password.',
        docsHref: `${URL_DOCS}/api-keys`,
        docsLabel: 'API key docs',
      },
      {
        q: 'How do I rotate a compromised API key?',
        a: 'Go to Settings → API Keys, find the compromised key, and click "Revoke". Then create a new key and update it in your integrations. Old keys are immediately invalidated on revocation.',
      },
      {
        q: 'What scopes can an API key have?',
        a: 'Keys can be scoped to: read (list and fetch resources), write (create and update resources), or admin (all operations including deletes and settings). Always use the minimum scope needed.',
      },
    ],
  },
  {
    id: 'billing',
    label: 'Billing & Plans',
    items: [
      {
        q: 'What plans are available?',
        a: `Celune Cloud costs $25 per seat per month, or $20 per seat per month billed annually. A seat is an active member of your organization; agents are free. Cloud has no usage limits on agents, workspaces, or memories, and you bring your own model keys. For custom terms or a dedicated contract, contact ${SALES_EMAIL} about Enterprise. Self-hosting the open-source edition is free.`,
        docsHref: `${URL_DOCS}/pricing`,
        docsLabel: 'Pricing details',
      },
      {
        q: 'How do I subscribe?',
        a: 'Go to Settings → Billing, choose monthly or annual, and click Subscribe to Celune Cloud. Seats match your active organization members and update automatically when you add or remove members, prorated for the rest of the billing period.',
      },
      {
        q: 'Are there usage limits?',
        a: 'No. Celune Cloud and Enterprise have no limits on agents, workspaces, projects, tasks, or memories, under fair use. Model usage is billed by your own provider through your keys.',
      },
      {
        q: 'How do I download invoices?',
        a: 'Go to Settings → Billing → Manage billing. The billing portal lists all invoices with a download link. Invoices are also emailed to the billing email address on file.',
      },
      {
        q: 'Can I cancel anytime?',
        a: 'Yes. Cancel from Settings → Billing → Manage billing. Your plan remains active until the end of your billing period. No cancellation fees.',
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [
      {
        q: 'How do I connect Slack?',
        a: 'Go to Settings → Integrations → Slack. Click "Connect to Slack" and authorize the app. Once connected, agents can post updates to channels and you can trigger agent runs from Slack commands.',
        docsHref: `${URL_DOCS}/integrations/slack`,
        docsLabel: 'Slack integration guide',
      },
      {
        q: 'Can I use my own LLM API key (BYOK)?',
        a: 'BYOK (Bring Your Own Key) is included in every plan. Go to Settings → Integrations → LLM Providers. Add your Anthropic or OpenAI API key and agents will use it instead of managed credits.',
      },
      {
        q: 'Does Celune integrate with GitHub?',
        a: 'GitHub integration is available via MCP. Add the GitHub MCP server in Settings → MCP Connections. Agents can then read repos, create PRs, review code, and comment on issues.',
        docsHref: `${URL_DOCS}/mcp/github`,
        docsLabel: 'GitHub MCP setup',
      },
    ],
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    items: [
      {
        q: 'I\'m seeing a "permission denied" error. What do I do?',
        a: "This usually means your account role doesn't have the required permission for that action. Check with your workspace owner to confirm your role. If you are the owner and still see this, contact support with your user ID and the action you were trying to perform.",
      },
      {
        q: 'The app is loading slowly. What should I do?',
        a: `Try a hard refresh (Ctrl+Shift+R or Cmd+Shift+R). Clear your browser cache. Check our status page at ${URL_STATUS}. If the issue persists, submit a support ticket with your browser version and steps to reproduce.`,
      },
      {
        q: 'I lost access to my workspace. What should I do?',
        a: 'If you were removed by an admin, contact your workspace owner. If you owned the workspace and lost access due to a billing issue, go to Settings → Billing to resolve the payment. For other access issues, contact support with your workspace ID.',
      },
      {
        q: "Voice mode isn't working. How do I fix it?",
        a: 'Voice mode requires microphone permission in your browser. Go to your browser settings and allow microphone access for this site. Voice uses the ElevenLabs TTS engine and requires an active internet connection. If TTS plays but recognition fails, try Chrome or Edge for best speech recognition support.',
      },
    ],
  },
  {
    id: 'onboarding',
    label: 'Onboarding & Setup',
    items: [
      {
        q: 'What is the onboarding process?',
        a: 'Onboarding has three steps: (1) Welcome, where you name and customize your lead agent. (2) Connect Your Tools, where you set up your IDE, AI provider key, and optionally GitHub. (3) Agent Interview, where your agent learns about you through a short conversation. You can exit at any time and pick up where you left off when you sign back in.',
      },
      {
        q: 'Why do I need an IDE connection?',
        a: 'The IDE connection lets your Celune agents work alongside you inside your code editor. Celune connects to your IDE through the MCP (Model Context Protocol) standard, which is supported by VS Code, Cursor, Windsurf, and other editors. This is how your agents can read your code, suggest changes, and run commands directly in your development environment. During onboarding, you can either run a quick setup command or manually configure the connection for your specific editor. It is not strictly required — you can skip it and connect later from Settings.',
      },
      {
        q: 'What is an AI Provider Key and why do I need one?',
        a: 'An AI Provider Key is your own API key from an AI provider like Anthropic (Claude) or OpenAI. Celune uses a "bring your own key" (BYOK) model, which means you control your AI costs and data directly. To get one: (1) Go to console.anthropic.com and create an account. (2) Navigate to API Keys and create a new key. (3) Paste it into the AI Provider Key field in Celune. Your key is encrypted and only used to power your agents.',
      },
      {
        q: 'Is the GitHub connection required?',
        a: 'No, GitHub is optional. If connected, your agents can create branches, open pull requests, and manage code reviews automatically. You can always connect it later from Settings. To connect: click "Connect" next to GitHub, authorize the Celune GitHub App, and select which repositories to give access to.',
      },
      {
        q: 'Can I skip the onboarding?',
        a: 'You can exit onboarding at any time using the Exit button in the top right corner. Your progress is saved automatically, so when you sign back in, you will continue from where you left off. You can also skip the agent interview step if you prefer to set things up manually later.',
      },
      {
        q: 'What is the Agent Interview step?',
        a: 'The Agent Interview is a short conversation with your lead agent. It asks about your work, goals, and preferences so it can personalize your experience. The agent uses your answers to set up starter projects, configure your workspace, and remember your preferences for future interactions. It typically takes 3-5 minutes.',
      },
      {
        q: 'How do I customize my lead agent?',
        a: 'On the right side of the onboarding screen, you can customize your lead agent. Click the pencil icon next to the name to rename it. Click the avatar to choose a different image or upload your own. Use the personality sliders (Humor, Directness, Warmth, Formality, Verbosity) to adjust how your agent communicates with you.',
      },
      {
        q: 'I am stuck on the Connect Your Tools step. What should I do?',
        a: 'Here is a step-by-step guide: (1) IDE Connection: Click Connect, then either run the quick setup command in your terminal or choose your specific editor (Claude Code, Cursor, Windsurf) and follow the configuration instructions. You can also skip this and connect later from Settings. (2) AI Provider Key: Go to your AI provider (e.g. console.anthropic.com), create an API key, and paste it in. If you do not have an account yet, you can sign up for free. (3) GitHub: This is optional. Click Connect if you want automated git workflows, or skip it. Once at least the IDE and AI key are connected, the Continue button will activate.',
      },
    ],
  },
];
