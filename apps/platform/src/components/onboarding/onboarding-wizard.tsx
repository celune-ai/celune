'use client';

import Image from 'next/image';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowRight,
  Bell,
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  Github,
  LayoutDashboard,
  Loader2,
  Mail,
  MessageSquare,
  Terminal,
} from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@repo/ui/components/dialog';
import { toast } from 'sonner';
import { apiUrl } from '@repo/db/api';
import { useWorkspace } from '@/providers/workspace-provider';
import { URL_DOCS, URL_APP } from '@/lib/branding';
import { markOnboardingComplete, markOnboardingStarted } from './use-onboarding';

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  onFinish?: () => void;
}

type Step = 'welcome' | 'mcp' | 'github' | 'agents' | 'project' | 'comms' | 'done';

const STEPS: Step[] = ['welcome', 'mcp', 'github', 'agents', 'project', 'comms', 'done'];

function StepDots({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      role="progressbar"
      aria-valuenow={idx + 1}
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-label={`Onboarding step ${idx + 1} of ${STEPS.length}`}
    >
      {STEPS.map((s, i) => (
        <span
          key={s}
          aria-hidden="true"
          className={`inline-block h-1.5 rounded-full transition-all duration-300 ${
            i === idx ? 'bg-brand w-4' : i < idx ? 'bg-brand/40 w-1.5' : 'bg-surface-300 w-1.5'
          }`}
        />
      ))}
    </div>
  );
}

interface SeededAgent {
  agent_id: string;
  display_name: string;
  role: string;
  description: string;
  model: string;
  color: string;
  is_active: boolean;
}

export function OnboardingWizard({ open, onClose, onFinish }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [mcpKey, setMcpKey] = useState<string | null>(null);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [mcpCreating, setMcpCreating] = useState(false);
  const [seededAgents, setSeededAgents] = useState<SeededAgent[]>([]);
  const [agentPlan, setAgentPlan] = useState<string>('cloud');
  const [maxActiveAgents, setMaxActiveAgents] = useState(3);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const { activeWorkspace, refreshWorkspaces } = useWorkspace();

  // Use created workspace or existing active workspace
  const effectiveWorkspaceId = createdWorkspaceId ?? activeWorkspace?.id ?? null;

  async function handleSkip() {
    await markOnboardingComplete();
    onClose();
  }

  async function handleWelcomeContinue() {
    setSaving(true);
    try {
      // Save display name if provided
      if (displayName.trim()) {
        await fetch(apiUrl('/api/user/profile'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ display_name: displayName.trim() }),
        }).catch(() => {
          /* Best-effort — display name is non-blocking for onboarding */
        });
      }

      // Create workspace if name provided and user has no workspace yet
      if (workspaceName.trim() && !activeWorkspace) {
        const res = await fetch(apiUrl('/api/workspaces'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: workspaceName.trim() }),
        });

        if (res.ok) {
          const ws = await res.json();
          setCreatedWorkspaceId(ws.id);
          toast.success(`Workspace "${workspaceName.trim()}" created`);
          // Refresh workspace list so provider picks up the new workspace
          await refreshWorkspaces();
        } else {
          toast.error('Could not create workspace. You can create one later in Settings.');
        }
      }

      await markOnboardingStarted();
    } catch {
      // Non-blocking
    } finally {
      setSaving(false);
    }

    setStep('mcp');
  }

  async function handleGitHubContinue() {
    // Seed agents for the workspace when moving past GitHub step
    const wsId = effectiveWorkspaceId;
    if (wsId) {
      try {
        const res = await fetch(apiUrl('/api/agents/seed'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: wsId }),
        });
        if (res.ok) {
          const data = await res.json();
          setSeededAgents(data.agents ?? []);
          setAgentPlan(data.plan ?? 'cloud');
          if (data.maxActive) setMaxActiveAgents(data.maxActive);
        }
      } catch {
        // Non-blocking — agents page is still accessible
      }
    }
    setStep('agents');
  }

  async function handleProjectContinue() {
    if (!projectName.trim()) {
      setStep('comms');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(apiUrl('/api/projects'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDescription.trim() || null,
          project_type: 'feature',
          workspace_id: effectiveWorkspaceId,
        }),
      });

      if (res.ok) {
        toast.success(`Project "${projectName.trim()}" created`);
      }
    } catch {
      toast.error('Could not create project — you can create one later from the Projects page.');
    } finally {
      setSaving(false);
    }

    setStep('comms');
  }

  async function handleFinish() {
    await markOnboardingComplete();
    onClose();
    onFinish?.();
    toast.success("You're all set! Welcome to Celune.");
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0" aria-label="Onboarding wizard">
        <div className="space-y-6 px-6 py-6">
          {step === 'welcome' && (
            <WelcomeStep
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
              workspaceName={workspaceName}
              onWorkspaceNameChange={setWorkspaceName}
              hasWorkspace={!!activeWorkspace}
              onContinue={handleWelcomeContinue}
              saving={saving}
            />
          )}
          {step === 'mcp' && (
            <McpStep
              mcpKey={mcpKey}
              setMcpKey={setMcpKey}
              mcpConnected={mcpConnected}
              setMcpConnected={setMcpConnected}
              mcpCreating={mcpCreating}
              setMcpCreating={setMcpCreating}
              workspaceId={effectiveWorkspaceId}
              onContinue={() => setStep('github')}
            />
          )}
          {step === 'github' && (
            <GitHubStep workspaceId={effectiveWorkspaceId} onContinue={handleGitHubContinue} />
          )}
          {step === 'agents' && (
            <AgentTeamStep
              agents={seededAgents}
              plan={agentPlan}
              maxActive={maxActiveAgents}
              workspaceId={effectiveWorkspaceId}
              onAgentsChange={setSeededAgents}
              onContinue={() => setStep('project')}
            />
          )}
          {step === 'project' && (
            <ProjectStep
              projectName={projectName}
              projectDescription={projectDescription}
              onNameChange={setProjectName}
              onDescriptionChange={setProjectDescription}
              onContinue={handleProjectContinue}
              saving={saving}
            />
          )}
          {step === 'comms' && (
            <CommsStep
              workspaceId={effectiveWorkspaceId}
              onContinue={() => setStep('done')}
              onSkip={() => setStep('done')}
            />
          )}
          {step === 'done' && <DoneStep onFinish={handleFinish} />}
        </div>

        <div className="border-border border-t px-6 py-4">
          <StepDots current={step} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step: Welcome + Workspace Creation
// ---------------------------------------------------------------------------

function WelcomeStep({
  displayName,
  onDisplayNameChange,
  workspaceName,
  onWorkspaceNameChange,
  hasWorkspace,
  onContinue,
  saving,
}: {
  displayName: string;
  onDisplayNameChange: (v: string) => void;
  workspaceName: string;
  onWorkspaceNameChange: (v: string) => void;
  hasWorkspace: boolean;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="text-xl font-light">Welcome to Celune</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-sm font-light">
          Your platform for managing projects, tasks, and your AI agent team. Let&apos;s get you set
          up in a few quick steps.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-light">Name of your Organization</label>
          <Input
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            placeholder="Your company, app, business, etc..."
            autoFocus
          />
          <p className="text-foreground-lighter text-xs font-light">
            This appears in the app. You can change it later in Settings.
          </p>
        </div>

        {!hasWorkspace && (
          <div className="space-y-2">
            <label className="text-sm font-light">Workspace name</label>
            <Input
              value={workspaceName}
              onChange={(e) => onWorkspaceNameChange(e.target.value)}
              placeholder="e.g. My Team, Acme Corp"
              onKeyDown={(e) => e.key === 'Enter' && !saving && onContinue()}
            />
            <p className="text-foreground-lighter text-xs font-light">
              Workspaces are where your projects, tasks, and agents live.
            </p>
          </div>
        )}
      </div>

      <Button
        onClick={onContinue}
        className="w-full gap-2"
        disabled={saving || (!hasWorkspace && !workspaceName.trim())}
        aria-label="Continue to GitHub setup"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Setting up...
          </>
        ) : (
          <>
            Continue
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Connect GitHub
// ---------------------------------------------------------------------------

function GitHubStep({
  workspaceId,
  onContinue,
}: {
  workspaceId: string | null;
  onContinue: () => void;
}) {
  const [githubUser, setGithubUser] = useState<{
    username: string;
    avatar: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Detect if user signed in via GitHub OAuth
  useEffect(() => {
    async function detectGitHubAuth() {
      try {
        const { createClient } = await import('@repo/db/client');
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user?.app_metadata?.provider === 'github' && user.user_metadata) {
          setGithubUser({
            username: user.user_metadata.user_name || user.user_metadata.preferred_username || '',
            avatar: user.user_metadata.avatar_url || '',
          });
        }
      } catch {
        // Non-blocking
      } finally {
        setLoading(false);
      }
    }

    detectGitHubAuth();
  }, []);

  const handleInstallGitHub = () => {
    if (!workspaceId) {
      toast.error('Workspace not ready yet. Try again in a moment.');
      return;
    }
    // Redirect to GitHub App installation — callback will return to the app
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    window.location.assign(`${origin}/api/github/install?workspace_id=${workspaceId}`);
  };

  const isGitHubUser = !!githubUser;

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="bg-brand/10 mb-3 flex h-10 w-10 items-center justify-center rounded-full">
          <Github className="text-brand h-5 w-5" />
        </div>
        <DialogTitle>Connect GitHub</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-sm">
          {isGitHubUser
            ? 'One more step to unlock code reviews, PR tracking, and automated workflows.'
            : 'Link your repositories to enable code reviews, PR tracking, and automated workflows.'}
        </DialogDescription>
      </DialogHeader>

      {/* GitHub identity card — shown when signed in via GitHub */}
      {!loading && isGitHubUser && (
        <div className="border-brand/20 bg-brand/5 flex items-center gap-3 rounded-lg border p-3">
          {githubUser.avatar ? (
            <Image
              src={githubUser.avatar}
              alt={githubUser.username}
              className="ring-brand/30 h-9 w-9 rounded-full ring-2"
              width={36}
              height={36}
              unoptimized
            />
          ) : (
            <div className="bg-brand/10 flex h-9 w-9 items-center justify-center rounded-full">
              <Github className="text-brand h-4 w-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-sm font-medium">{githubUser.username}</p>
            <p className="text-brand text-xs">Signed in with GitHub</p>
          </div>
          <CheckCircle2 className="text-brand h-4 w-4 shrink-0" />
        </div>
      )}

      <div className="border-border bg-surface-200 space-y-3 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <Github className="text-foreground-lighter mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-foreground text-sm font-medium">
              {isGitHubUser ? 'Grant repository access' : 'Install the Celune GitHub App'}
            </p>
            <p className="text-foreground-lighter text-xs">
              {isGitHubUser
                ? 'Your identity is verified — now choose which repos to connect.'
                : 'Choose which repositories to connect. You can change this later in Settings.'}
            </p>
          </div>
        </div>
        <Button onClick={handleInstallGitHub} className="w-full gap-2" disabled={!workspaceId}>
          <Github className="h-4 w-4" />
          {isGitHubUser ? 'Connect Repos' : 'Connect GitHub'}
        </Button>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="text-foreground-lighter hover:text-foreground w-full cursor-pointer text-center text-xs transition-colors"
        aria-label="Skip GitHub setup"
      >
        Skip for now
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Agent Team
// ---------------------------------------------------------------------------

function AgentTeamStep({
  agents,
  plan,
  maxActive,
  workspaceId,
  onAgentsChange,
  onContinue,
}: {
  agents: SeededAgent[];
  plan: string;
  maxActive: number;
  workspaceId: string | null;
  onAgentsChange: (agents: SeededAgent[]) => void;
  onContinue: () => void;
}) {
  const [toggling, setToggling] = useState<string | null>(null);
  const activeCount = agents.filter((a) => a.is_active).length;

  async function handleToggle(agentId: string, newActive: boolean) {
    if (!workspaceId) return;
    // Prevent activating beyond limit
    if (newActive && activeCount >= maxActive) {
      toast.error(`You can employ up to ${maxActive} agents on your current plan.`);
      return;
    }
    // Prevent deactivating last agent
    if (!newActive && activeCount <= 1) {
      toast.error('You must have at least one active agent.');
      return;
    }

    setToggling(agentId);
    try {
      const res = await fetch(apiUrl('/api/agents/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          agent_id: agentId,
          is_active: newActive,
        }),
      });
      if (res.ok) {
        onAgentsChange(
          agents.map((a) => (a.agent_id === agentId ? { ...a, is_active: newActive } : a)),
        );
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to update agent');
      }
    } catch {
      toast.error('Failed to update agent');
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="bg-brand/10 mb-3 flex h-10 w-10 items-center justify-center rounded-full">
          <Bot className="text-brand h-5 w-5" />
        </div>
        <DialogTitle>Your AI agent team</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-sm">
          {agents.length > 0 ? (
            <>
              {agents.length} agents available.{' '}
              <span className="text-foreground font-medium">
                {activeCount}/{maxActive} employed
              </span>{' '}
              — toggle agents on or off below.
            </>
          ) : (
            'Your agents will be provisioned when your workspace is ready.'
          )}
        </DialogDescription>
      </DialogHeader>

      {agents.length > 0 && (
        <div className="space-y-2">
          {agents.map((agent) => {
            const isActive = agent.is_active;
            const isToggling = toggling === agent.agent_id;
            const canActivate = activeCount < maxActive;

            return (
              <div
                key={agent.agent_id}
                className={`border-border flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  isActive ? 'bg-surface-200' : 'bg-surface-75 opacity-60'
                }`}
              >
                <div
                  className="text-foreground-contrast flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ backgroundColor: isActive ? agent.color : '#6b7280' }}
                >
                  {agent.display_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-medium">{agent.display_name}</p>
                  <p className="text-foreground-lighter truncate text-xs">{agent.role}</p>
                </div>
                <button
                  type="button"
                  disabled={isToggling || (!isActive && !canActivate)}
                  onClick={() => handleToggle(agent.agent_id, !isActive)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-brand/10 text-brand hover:bg-brand/20'
                      : canActivate
                        ? 'bg-surface-200 text-foreground-lighter hover:bg-surface-300'
                        : 'bg-surface-200 text-foreground-lighter cursor-not-allowed'
                  }`}
                >
                  {isToggling ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isActive ? (
                    'Employed'
                  ) : (
                    'Employ'
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {agents.length === 0 && (
        <div className="border-border bg-surface-200 rounded-lg border p-4 text-center">
          <Bot className="text-foreground-lighter mx-auto mb-2 h-8 w-8" />
          <p className="text-foreground-lighter text-sm">
            Agents will appear here once your workspace is set up.
          </p>
        </div>
      )}

      <Button onClick={onContinue} className="w-full gap-2">
        Continue
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Create First Project
// ---------------------------------------------------------------------------

function ProjectStep({
  projectName,
  projectDescription,
  onNameChange,
  onDescriptionChange,
  onContinue,
  saving,
}: {
  projectName: string;
  projectDescription: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="bg-brand/10 mb-3 flex h-10 w-10 items-center justify-center rounded-full">
          <FolderOpen className="text-brand h-5 w-5" />
        </div>
        <DialogTitle>Create your first project</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-sm">
          Projects help you organize work into focused areas. You can skip this and create one
          later.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Project name</label>
          <Input
            value={projectName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Website Redesign"
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Description</label>
          <Textarea
            value={projectDescription}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="What are you building? (optional)"
            rows={2}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onContinue} className="flex-1" disabled={saving}>
          Skip
        </Button>
        <Button onClick={onContinue} className="flex-1 gap-2" disabled={saving}>
          {saving ? 'Creating...' : projectName.trim() ? 'Create & Continue' : 'Continue'}
          {!saving && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Done
// ---------------------------------------------------------------------------

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-5 text-center">
      <div className="flex justify-center">
        <div className="bg-brand/10 flex h-16 w-16 items-center justify-center rounded-full">
          <CheckCircle2 className="text-brand h-8 w-8" />
        </div>
      </div>

      <DialogHeader>
        <DialogTitle className="text-center text-xl">You&apos;re ready to go</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-center text-sm">
          Celune is set up. Start by creating tasks, exploring the team of AI agents, or checking
          out the analytics.
        </DialogDescription>
      </DialogHeader>

      <Button onClick={onFinish} className="w-full">
        Open Celune
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: Comms Setup (Notifications)
// ---------------------------------------------------------------------------

function CommsStep({
  workspaceId,
  onContinue,
  onSkip,
}: {
  workspaceId: string | null;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const handleConnectSlack = () => {
    if (!workspaceId) {
      onContinue();
      return;
    }
    // Redirect to Slack OAuth; callback will return to onboarding
    window.location.assign(
      `${origin}/api/notifications/slack/connect?workspace_id=${workspaceId}&from=onboarding`,
    );
  };

  const channels: Array<{
    key: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
    recommended?: boolean;
    onClick?: () => void;
    href?: string;
    disabled?: boolean;
  }> = [
    {
      key: 'email',
      label: 'Email',
      description: 'Receive email digests and alerts',
      icon: Mail,
      badge: 'On by default',
    },
    {
      key: 'slack',
      label: 'Slack',
      description: "Get notified in your team's Slack workspace",
      icon: MessageSquare,
      recommended: true,
      onClick: handleConnectSlack,
    },
    {
      key: 'discord',
      label: 'Discord',
      description: 'Get notified in your Discord server',
      icon: Bell,
      badge: 'Coming Soon',
      disabled: true,
    },
    {
      key: 'teams',
      label: 'Microsoft Teams',
      description: 'Get notified in your Teams channels',
      icon: Bell,
      badge: 'Coming Soon',
      disabled: true,
    },
    {
      key: 'sdk',
      label: 'Custom via SDK',
      description: 'Build your own integration',
      icon: ExternalLink,
      href: `${URL_DOCS}/notifications/custom-sdk`,
    },
  ];

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="bg-brand/10 mb-3 flex h-10 w-10 items-center justify-center rounded-full">
          <Bell className="text-brand h-5 w-5" />
        </div>
        <DialogTitle>Set up notifications</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-sm">
          So your agents can reach you when something important happens.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        {channels.map(
          ({
            key,
            label,
            description,
            icon: Icon,
            badge,
            recommended,
            onClick,
            href,
            disabled,
          }) => {
            const isClickable = !disabled && (onClick || href);
            const Wrapper = href ? 'a' : 'button';
            const wrapperProps = href
              ? { href, target: '_blank', rel: 'noopener noreferrer' }
              : { type: 'button' as const, onClick: onClick ?? (() => {}) };

            return (
              <div
                key={key}
                className={`border-border bg-surface-200 flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors ${
                  disabled
                    ? 'cursor-not-allowed opacity-50'
                    : isClickable
                      ? 'hover:border-brand/40 cursor-pointer'
                      : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="bg-brand/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
                    <Icon className="text-brand h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-foreground text-sm font-medium">{label}</p>
                      {recommended && (
                        <span className="bg-brand/10 text-brand rounded px-1.5 py-0.5 text-xs font-medium">
                          Recommended
                        </span>
                      )}
                      {badge && (
                        <span className="bg-surface-300 text-foreground-lighter rounded px-1.5 py-0.5 text-xs">
                          {badge}
                        </span>
                      )}
                    </div>
                    <p className="text-foreground-lighter text-xs">{description}</p>
                  </div>
                </div>

                {!disabled && isClickable && (
                  <Wrapper
                    {...(wrapperProps as Record<string, unknown>)}
                    className="text-foreground-lighter hover:text-foreground shrink-0 transition-colors"
                    aria-label={`Set up ${label}`}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Wrapper>
                )}
              </div>
            );
          },
        )}
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="text-foreground-lighter hover:text-foreground w-full cursor-pointer text-center text-xs transition-colors"
      >
        Set up later in Settings
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: MCP Setup
// ---------------------------------------------------------------------------

function McpStep({
  mcpKey,
  setMcpKey,
  mcpConnected,
  setMcpConnected,
  mcpCreating,
  setMcpCreating,
  workspaceId,
  onContinue,
}: {
  mcpKey: string | null;
  setMcpKey: (k: string | null) => void;
  mcpConnected: boolean;
  setMcpConnected: (c: boolean) => void;
  mcpCreating: boolean;
  setMcpCreating: (c: boolean) => void;
  workspaceId: string | null;
  onContinue: () => void;
}) {
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const keyCreatedRef = useRef(false);
  const cancelledRef = useRef(false);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }, []);

  // Create API key once when workspace is available
  useEffect(() => {
    if (keyCreatedRef.current || mcpKey || !workspaceId) return;
    keyCreatedRef.current = true;

    async function createKey() {
      setMcpCreating(true);
      try {
        const res = await fetch(apiUrl('/api/api-keys'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Onboarding MCP Key',
            scopes: ['write'],
            workspace_id: workspaceId,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setMcpKey(data.plaintext_key);
        } else {
          toast.error('Failed to create API key');
        }
      } catch {
        toast.error('Failed to create API key');
      } finally {
        setMcpCreating(false);
      }
    }
    createKey();
  }, [mcpKey, workspaceId, setMcpKey, setMcpCreating]);

  // Check initial level + poll for connection
  useEffect(() => {
    cancelledRef.current = false;

    async function checkLevel() {
      if (cancelledRef.current) return false;
      try {
        const res = await fetch(apiUrl('/api/user/level'));
        if (res.ok) {
          const data = await res.json();
          if (data.level >= 2 && !cancelledRef.current) {
            setMcpConnected(true);
            return true;
          }
        }
      } catch {}
      return false;
    }

    // Check immediately
    checkLevel().then((connected) => {
      if (connected) return;

      // Poll every 3s
      pollRef.current = setInterval(async () => {
        const connected = await checkLevel();
        if (connected && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 3000);

      // 2-min timeout auto-advance
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        toast.info('IDE connection skipped — you can set this up later in Settings.');
        onContinueRef.current();
      }, 120_000);
    });

    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [setMcpConnected]);

  const origin = typeof window !== 'undefined' ? window.location.origin : URL_APP;
  const cliCommand = mcpKey
    ? `claude mcp add --transport http celune ${origin}/api/mcp --header "Authorization: Bearer ${mcpKey}" --scope user`
    : '';
  const mcpJson = mcpKey
    ? JSON.stringify(
        {
          mcpServers: {
            celune: {
              type: 'http',
              url: `${origin}/api/mcp`,
              headers: { Authorization: `Bearer ${mcpKey}` },
            },
          },
        },
        null,
        2,
      )
    : '';

  if (mcpConnected) {
    return (
      <div className="space-y-5">
        <DialogHeader>
          <div className="bg-brand/10 mb-3 flex h-10 w-10 items-center justify-center rounded-full">
            <CheckCircle2 className="text-brand h-5 w-5" />
          </div>
          <DialogTitle>IDE Connected!</DialogTitle>
          <DialogDescription className="text-foreground-lighter text-sm">
            Your IDE is connected. Celune will use your IDE&apos;s AI subscription for all features
            — zero additional cost.
          </DialogDescription>
        </DialogHeader>
        <Button onClick={onContinue} className="w-full gap-2">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="bg-brand/10 mb-3 flex h-10 w-10 items-center justify-center rounded-full">
          <Terminal className="text-brand h-5 w-5" />
        </div>
        <DialogTitle>Connect Your IDE</DialogTitle>
        <DialogDescription className="text-foreground-lighter text-sm">
          Celune runs AI through your coding tool — no separate API key needed. Run this command in
          your terminal:
        </DialogDescription>
      </DialogHeader>

      {mcpCreating && (
        <div className="text-foreground-lighter text-center text-sm">Creating API key...</div>
      )}

      {mcpKey && (
        <div className="space-y-3">
          <div className="bg-surface-100 rounded px-3 py-2">
            <code className="text-foreground block font-mono text-xs whitespace-pre-wrap">
              {cliCommand}
            </code>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyToClipboard(cliCommand)}
            className="w-full"
          >
            <Copy className="mr-1.5 h-3 w-3" />
            Copy command
          </Button>
          <p className="text-foreground-lighter mt-1 text-[11px]">
            Contains your API key — don&apos;t share publicly.
          </p>

          <details className="mt-2">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              Or add to .mcp.json (for project sharing)
            </summary>
            <div className="bg-surface-100 mt-2 rounded px-3 py-2">
              <code className="text-foreground block font-mono text-xs whitespace-pre-wrap">
                {mcpJson}
              </code>
            </div>
          </details>

          <div className="text-foreground-lighter flex items-center gap-2 text-xs">
            <span className="bg-brand inline-block h-1.5 w-1.5 animate-pulse rounded-full" />
            Waiting for connection...
          </div>
        </div>
      )}

      <Button variant="outline" onClick={onContinue} className="w-full">
        Set up later
      </Button>
    </div>
  );
}
