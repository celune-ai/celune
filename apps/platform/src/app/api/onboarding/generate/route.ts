import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { seedDefaultAgents } from '@/lib/agent-seed';
import { seedDefaultSkillPacks } from '@repo/db/skill-loader';

import {
  seedCoreKnowledge,
  seedIntegrationMemories,
  seedAgentMemories,
  seedTeamMemories,
  generateWorkspaceClaudeMd,
} from '@/lib/seed-knowledge-packs';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import Anthropic from '@anthropic-ai/sdk';
import { validateOrigin } from '@/lib/csrf';
import { onboardingGenerateSchema } from '@/lib/schemas/onboarding.schema';

import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Learning Project — 8 fixed tutorial tasks
// ---------------------------------------------------------------------------

const LEARNING_TASKS = [
  {
    title: 'Claim this task and mark it complete',
    description: `## What\nThis is your very first task. Claim it, complete it, and write a short outcome.\n\n## Approach\n1. Click "Claim" to assign this task to yourself\n2. Work through it (you're doing that now!)\n3. Click "Complete" and write what you learned\n\n## Value\nYou'll understand the core task lifecycle: inbox → in_progress → done. Every task in Celune follows this pattern.`,
    priority: 'high',
    tutorial_step: 1,
  },
  {
    title: 'Explore the Agents page and say hello to one',
    description: `## What\nNavigate to the Agents page and have your first conversation with an agent.\n\n## Approach\n1. Click "Agents" in the sidebar\n2. Find your Agent Lead (the one you just created)\n3. Say hello and ask a question\n4. Notice how the agent responds in character\n\n## Value\nThis is THE activation event. Your agent is a real collaborator, not a chatbot. This moment is when Celune clicks.`,
    priority: 'urgent',
    tutorial_step: 2,
  },
  {
    title: 'Create your first task using AI generation',
    description: `## What\nUse the AI task generation feature to create a task from a natural language description.\n\n## Approach\n1. Click "+ New Task" or use the command palette\n2. Describe what you want to accomplish in plain language\n3. Watch the AI generate a structured task with title, description, and metadata\n4. Review and edit if needed\n\n## Value\nAI generation turns fuzzy ideas into actionable work items. You'll use this constantly.`,
    priority: 'normal',
    tutorial_step: 3,
  },
  {
    title: 'Connect your first MCP integration',
    description: `## What\nConnect Claude Code to Celune using the MCP protocol. This is how your CLI tools talk to your task board.\n\n## Approach\n1. Go to Settings → API Keys\n2. Create a new API key\n3. Copy the MCP connection command shown after creation\n4. Run it in your terminal: \`claude mcp add ...\`\n5. Verify by asking Claude Code to list your tasks\n\n## Value\nMCP bridges your IDE and your task system. Tasks, memory, and projects are all accessible from your coding environment.`,
    priority: 'high',
    tutorial_step: 4,
  },
  {
    title: 'Run your first agent task from the CLI',
    description: `## What\nClaim and complete a task entirely from Claude Code using MCP tools.\n\n## Approach\n1. In Claude Code, ask: "List my Celune tasks"\n2. Claim one of the tasks\n3. Work on it and complete it with an outcome\n4. Verify the task status updated in the Celune dashboard\n\n## Value\nThe CLI-first workflow is the power-user path. You can manage your entire work system without leaving your editor.`,
    priority: 'normal',
    tutorial_step: 5,
  },
  {
    title: 'Explore the Memory system',
    description: `## What\nUnderstand how Celune stores and recalls context about you and your work.\n\n## Approach\n1. Go to the Memory page in the sidebar\n2. Browse existing memories (created during onboarding Q&A)\n3. Try searching for something you mentioned during setup\n4. Notice how memories are categorized: context, preference, fact, decision\n\n## Value\nMemory is what makes your agents persistent. They remember your preferences, past decisions, and working context across sessions.`,
    priority: 'normal',
    tutorial_step: 6,
  },
  {
    title: 'Set up your first project group',
    description: `## What\nOrganize related projects into a group (like an epic or initiative).\n\n## Approach\n1. Go to the Projects page\n2. Create a new project group\n3. Move this Learning Project and your Goal Project into the group\n4. See how grouping helps organize related work\n\n## Value\nProject groups are your top-level organizing structure. They map to initiatives, sprints, or any logical grouping of work.`,
    priority: 'normal',
    tutorial_step: 7,
  },
  {
    title: 'Complete this project and review your activation',
    description: `## What\nYou've completed the Getting Started project! Review what you've learned and plan what's next.\n\n## Approach\n1. Review all completed tasks in this project\n2. Check the Memory page — see how your onboarding context was stored\n3. Open your Goal Project — this is personalized to your actual work\n4. Claim your first real task from the Goal Project\n\n## Value\nYou've gone from zero to a working second brain. Your agents know your context, your tools are connected, and your work is organized. Now the real work begins.`,
    priority: 'normal',
    tutorial_step: 8,
  },
];

// ---------------------------------------------------------------------------
// Goal Project — template selection + AI generation
// ---------------------------------------------------------------------------

interface TemplateMatch {
  name: string;
  description: string;
}

function selectTemplate(role: string, goal: string): TemplateMatch {
  const key = `${role.toLowerCase()}:${goal.toLowerCase()}`;
  const templates: Record<string, TemplateMatch> = {
    'developer:ship': {
      name: 'Product Launch System',
      description: 'Ship your product with a structured launch plan',
    },
    'developer:build': {
      name: 'Engineering Infrastructure',
      description: 'Build robust engineering systems and infrastructure',
    },
    'founder:ship': {
      name: 'Startup Execution System',
      description: 'Execute on your startup vision with focus and speed',
    },
    'founder:grow': {
      name: 'Growth & Distribution System',
      description: 'Grow your audience and distribution channels systematically',
    },
    'founder:manage': {
      name: 'Team Operating System',
      description: 'Build and manage a high-performing team',
    },
    'designer:ship': {
      name: 'Design & Launch System',
      description: 'Design and launch products with craft and speed',
    },
    'researcher:learn': {
      name: 'Research & Learning System',
      description: 'Deep research and structured learning',
    },
    'writer:grow': {
      name: 'Content Creation System',
      description: 'Create and distribute content that grows your audience',
    },
    'operator:manage': {
      name: 'Operations Command Center',
      description: 'Run operations with precision and visibility',
    },
  };

  // Fuzzy match: check if role or goal keywords appear
  for (const [k, v] of Object.entries(templates)) {
    const [r, g] = k.split(':');
    if (role.toLowerCase().includes(r!) && goal.toLowerCase().includes(g!)) {
      return v;
    }
  }

  return {
    name: 'Personal Productivity System',
    description: 'Organize your work and achieve your goals',
  };
}

async function generateGoalTasks(
  role: string,
  goal: string,
  domain: string,
  template: TemplateMatch,
): Promise<Array<{ title: string; description: string; priority: string; assignee: string }>> {
  const anthropic = new Anthropic();

  const prompt = `The user is a ${role} working on "${goal}" in the ${domain || 'general'} domain.
Generate 5 specific, actionable tasks for their "${template.name}" project.

## Task Mix (MANDATORY)
- 2 tasks assigned to "user" — tactical checklist items THEY do (review, decide, configure, approve)
- 3 tasks assigned to "lead" — ambitious work their Lead agent executes (research, draft, build, analyze)

## Task Description Format

For USER tasks:
## What
Specific action to take.

## Checklist
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Why This Matters
One sentence.

For AGENT tasks (lead):
## What
Detailed scope. Be specific to their domain: ${domain || 'general'}.

## Approach
1. First step (specific to their situation as a ${role})
2. Second step
3. Third step

## Expected Deliverable
What the agent produces.

## Value
Why this moves the needle on "${goal}".

## Rules
- Every task title MUST reference the user's actual goal, domain, or role. Generic titles are rejected.
- Task titles must be under 70 characters, imperative voice.
- Agent task descriptions should be 2-3x longer than user tasks — they need detailed instructions.
- Write as a senior strategist: 'Based on your goal to...' 'Given your background in...'
- First 2 tasks should be high/urgent priority.

Return ONLY valid JSON array with objects having: title, description, priority (urgent/high/normal), assignee ("user" or "lead").`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Extract JSON array from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    // Fallback: generate generic but role-specific tasks with user/agent mix
    return [
      {
        title: `Define ${goal} milestones and success criteria`,
        description: `## What\nBreak down "${goal}" into measurable milestones you can track.\n\n## Checklist\n- [ ] List your top 3 outcomes for this goal\n- [ ] Define what "done" looks like for each\n- [ ] Set a target date for the first milestone\n\n## Why This Matters\nClarity on what "done" looks like prevents scope creep and keeps your agent team aligned.`,
        priority: 'urgent',
        assignee: 'user',
      },
      {
        title: `Research best practices for ${goal}`,
        description: `## What\nInvestigate proven approaches, frameworks, and tools that successful ${role}s use to achieve "${goal}".\n\n## Approach\n1. Survey industry best practices and case studies for "${goal}" in the ${domain || 'general'} space\n2. Identify 3-5 frameworks or methodologies that apply to this context\n3. Evaluate tools and platforms that accelerate progress\n4. Compile findings into a structured recommendation document\n\n## Expected Deliverable\nA research brief with: top 3 recommended approaches, pros/cons of each, and a suggested starting point.\n\n## Value\nStarting with proven patterns saves weeks of trial and error.`,
        priority: 'high',
        assignee: 'lead',
      },
      {
        title: `Draft ${goal} execution roadmap`,
        description: `## What\nCreate a phased execution plan that turns "${goal}" into a sequence of concrete sprints.\n\n## Approach\n1. Break the goal into 3-4 phases (foundation → build → optimize → scale)\n2. For each phase, define 2-3 key deliverables\n3. Identify dependencies between phases\n4. Flag risks and mitigation strategies for each phase\n\n## Expected Deliverable\nA roadmap document with phases, deliverables, dependencies, and risk flags.\n\n## Value\nA clear roadmap means your agent team can start executing phase 1 immediately while you focus on decisions only you can make.`,
        priority: 'high',
        assignee: 'lead',
      },
      {
        title: `Review and approve the execution roadmap`,
        description: `## What\nReview the roadmap your Lead agent created and make key decisions.\n\n## Checklist\n- [ ] Read through all phases and deliverables\n- [ ] Approve or adjust the phase order\n- [ ] Flag any phases that need your direct involvement\n- [ ] Greenlight phase 1 for execution\n\n## Why This Matters\nYour approval unlocks autonomous execution — your agents can start building while you focus on strategy.`,
        priority: 'normal',
        assignee: 'user',
      },
      {
        title: `Build ${role} workflow for ${domain || 'your domain'}`,
        description: `## What\nDesign and document a repeatable workflow tailored to your role as a ${role} working on "${goal}".\n\n## Approach\n1. Map the current end-to-end process (inputs → steps → outputs)\n2. Identify friction points and bottlenecks\n3. Design an optimized workflow with clear handoff points between you and your agents\n4. Document the workflow as a reusable template\n\n## Expected Deliverable\nA workflow document with: current state diagram, proposed improvements, and agent delegation points.\n\n## Value\nA clear workflow reduces cognitive load and lets your agents handle the repetitive parts autonomously.`,
        priority: 'normal',
        assignee: 'lead',
      },
    ];
  }

  try {
    const tasks = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      description: string;
      priority: string;
      assignee?: string;
    }>;
    const validAssignees = new Set(['user', 'lead', 'researcher', 'reviewer', 'pm']);
    // Validate specificity: each title should reference something from the user's context
    const signals = [role, goal, domain].filter(Boolean).map((s) => s.toLowerCase());
    return tasks
      .map((t) => ({
        ...t,
        priority: t.priority || 'normal',
        assignee: validAssignees.has(t.assignee ?? '') ? t.assignee! : 'user',
      }))
      .filter((t) => {
        const titleLower = t.title.toLowerCase();
        return signals.some((s) => titleLower.includes(s.substring(0, 4)));
      })
      .slice(0, 5);
  } catch (err) {
    console.error('[generate] AI task parse failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Background seeding — runs after the response is sent to the client
// ---------------------------------------------------------------------------

async function seedWorkspaceContent(params: {
  userId: string;
  workspaceId: string;
  orgId: string | null;
  agentId: string | undefined;
  role: string;
  goal: string;
  domain: string;
  autonomy: string;
  detectedUseCase: string | undefined;
}): Promise<void> {
  const { userId, workspaceId, orgId, agentId, role, goal, domain, autonomy, detectedUseCase } =
    params;

  // Service client for background work (the user's auth context is gone after
  // the response is sent, so we use the service role key).
  const service = createServiceClient();

  // Re-seed agents with use-case-aware roster (idempotent)
  if (detectedUseCase) {
    try {
      const { plan } = await resolveWorkspacePlan(workspaceId, userId);
      const seedResult = await seedDefaultAgents(workspaceId, plan, userId, detectedUseCase, {
        role,
        goal,
      });

      // Seed template + role memories for the matched team
      if (seedResult.templateId && orgId) {
        await seedTeamMemories({
          userId,
          orgId,
          workspaceId,
          templateId: seedResult.templateId,
          agentRoles: seedResult.agentIds ?? [],
        }).catch((err) => {
          console.error('[onboarding/generate] team memories seed failed:', err);
        });
      }

      // Seed default skill packs based on team type
      await seedDefaultSkillPacks(
        workspaceId,
        plan,
        userId,
        seedResult.templateCategory ?? undefined,
      ).catch((err) => {
        console.error('[onboarding/generate] skill pack seed failed:', err);
      });
    } catch (err) {
      console.error('[onboarding/generate] use-case agent re-seed failed:', err);
    }
  }

  // 1. Create Learning Project (idempotent — check if exists)
  const { data: existingLearning } = await service
    .from('projects')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('project_type', 'feature')
    .eq('name', 'Getting Started with Celune')
    .maybeSingle();

  if (!existingLearning) {
    const { data: lp, error: lpErr } = await service
      .from('projects')
      .insert({
        name: 'Getting Started with Celune',
        description:
          'Your interactive guide to Celune. Complete these 8 tasks to master the platform.',
        project_type: 'feature',
        project_status: 'active',
        workspace_id: workspaceId,
        org_id: orgId,
        user_id: userId,
      })
      .select('id')
      .single();

    if (!lpErr && lp) {
      const learningRows = LEARNING_TASKS.map((t, i) => ({
        title: t.title,
        description: t.description,
        status: 'inbox' as const,
        priority: t.priority,
        project_id: lp.id,
        workspace_id: workspaceId,
        org_id: orgId,
        user_id: userId,
        sort_order: i,
        metadata: {
          tutorial_step: t.tutorial_step,
          is_template_task: true,
          onboarding_project_type: 'learning',
        },
      }));
      const { error: ltErr } = await service.from('tasks').insert(learningRows);
      if (ltErr) console.error('[onboarding/generate] learning tasks insert failed:', ltErr);
    } else if (lpErr) {
      console.error('[onboarding/generate] learning project insert failed:', lpErr);
    }
  }

  // 2. Create Goal Project (AI-generated, idempotent)
  const { data: existingGoal } = await service
    .from('projects')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('project_type', 'plan')
    .ilike('name', '%Goal%')
    .maybeSingle();

  if (!existingGoal) {
    const template = selectTemplate(role, goal);

    const { data: gp, error: gpErr } = await service
      .from('projects')
      .insert({
        name: template.name,
        description: `${template.description}\n\nPersonalized for: ${(role || 'you').slice(0, 200)} working on "${(goal || 'your goals').slice(0, 500)}"`,
        project_type: 'plan',
        project_status: 'active',
        workspace_id: workspaceId,
        org_id: orgId,
        user_id: userId,
      })
      .select('id')
      .single();

    if (!gpErr && gp) {
      const GOAL_ASSIGNEE_MAP: Record<string, string> = {
        user: 'unassigned',
        lead: 'rick',
        researcher: 'delv',
        reviewer: 'scan',
        pm: 'sage',
      };

      const goalTasks = await generateGoalTasks(role, goal, domain, template);
      if (goalTasks.length > 0) {
        const goalRows = goalTasks.map((t, i) => ({
          title: t.title,
          description: t.description,
          status: 'inbox' as const,
          priority: t.priority,
          assignee: GOAL_ASSIGNEE_MAP[t.assignee] ?? 'unassigned',
          project_id: gp.id,
          workspace_id: workspaceId,
          org_id: orgId,
          user_id: userId,
          sort_order: i,
          metadata: {
            is_template_task: true,
            onboarding_project_type: 'goal',
            assigned_role: t.assignee,
          },
        }));
        const { error: gtErr } = await service.from('tasks').insert(goalRows);
        if (gtErr) console.error('[onboarding/generate] goal tasks insert failed:', gtErr);
      }
    } else if (gpErr) {
      console.error('[onboarding/generate] goal project insert failed:', gpErr);
    }
  }

  // Seed agent_status rows for each agent in the workspace
  try {
    const { data: agentConfigs } = await service
      .from('agent_configs')
      .select('agent_id, model')
      .eq('workspace_id', workspaceId);

    if (agentConfigs && agentConfigs.length > 0) {
      const statusRows = agentConfigs.map((a) => ({
        workspace_id: workspaceId,
        agent_name: a.agent_id,
        status: 'offline' as const,
        model: a.model,
        last_heartbeat: new Date().toISOString(),
        user_id: userId,
      }));

      await service.from('agent_status').upsert(statusRows, {
        onConflict: 'workspace_id,agent_name',
        ignoreDuplicates: true,
      });
    }
  } catch (err) {
    console.error('[onboarding/generate] agent_status seed failed:', err);
  }

  // Seed default cron_jobs for this workspace
  try {
    const cronRows = [
      {
        job_id: `heartbeat_check:${workspaceId}`,
        workspace_id: workspaceId,
        display_name: 'Heartbeat Check',
        schedule_description: 'Every 30 seconds',
        schedule_seconds: 30,
        enabled: true,
      },
      {
        job_id: `health_check:${workspaceId}`,
        workspace_id: workspaceId,
        display_name: 'Health Check',
        schedule_description: 'Every 5 minutes',
        schedule_seconds: 300,
        enabled: true,
      },
      {
        job_id: `heartbeat_digest:${workspaceId}`,
        workspace_id: workspaceId,
        display_name: 'Daily Heartbeat Digest',
        schedule_description: 'Daily',
        schedule_seconds: 86400,
        enabled: true,
      },
    ];

    await service.from('cron_jobs').upsert(cronRows, {
      onConflict: 'job_id',
      ignoreDuplicates: true,
    });
  } catch (err) {
    console.error('[onboarding/generate] cron_jobs seed failed:', err);
  }

  // Log bootstrap activity milestones
  try {
    const milestones = [
      {
        workspace_id: workspaceId,
        user_id: userId,
        event_type: 'workspace.initialized',
        description: 'Workspace initialized during onboarding',
        metadata: { source: 'onboarding' },
      },
      {
        workspace_id: workspaceId,
        user_id: userId,
        event_type: 'agents.seeded',
        description: 'Agent team seeded from template',
        metadata: { source: 'onboarding', use_case: detectedUseCase ?? 'default' },
      },
    ];

    await service.from('activity_log').insert(milestones);
  } catch (err) {
    console.error('[onboarding/generate] activity milestones failed:', err);
  }

  // Store autonomy preference
  if (autonomy) {
    await service
      .from('agent_memory')
      .insert({
        key: `workspace:${workspaceId}:autonomy-preference`,
        content: `User's working style preference: ${autonomy}`,
        category: 'preference',
        memory_type: 'preference',
        source: 'onboarding',
        importance_score: 0.9,
        user_id: userId,
        workspace_id: workspaceId,
        agent_id: agentId ?? null,
      })
      .then(({ error }) => {
        if (error) console.error('[onboarding/generate] autonomy memory insert failed:', error);
      });
  }

  // Seed core + integration-gated knowledge (requires orgId)
  if (orgId) {
    const ctx = { userId, orgId, workspaceId };

    // Core knowledge pack (always-on workflow memories)
    await seedCoreKnowledge(ctx).catch((err) => {
      console.error('[onboarding/generate] core knowledge seed failed:', err);
    });

    // Seed integration-gated memories for any already-connected integrations
    const { data: wsIntegrations } = await service
      .from('workspaces')
      .select('github_installation_id, repo_url')
      .eq('id', workspaceId)
      .single();

    if (wsIntegrations?.github_installation_id && wsIntegrations?.repo_url) {
      await seedIntegrationMemories(ctx, 'github').catch((err) => {
        console.error('[onboarding/generate] github memories seed failed:', err);
      });
    }

    const { data: slackConn } = await service
      .from('slack_connections')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (slackConn) {
      await seedIntegrationMemories(ctx, 'slack').catch((err) => {
        console.error('[onboarding/generate] slack memories seed failed:', err);
      });
    }

    const { data: providerKeys } = await service
      .from('provider_api_keys')
      .select('provider')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (providerKeys?.some((k) => k.provider === 'elevenlabs')) {
      await seedIntegrationMemories(ctx, 'voice').catch((err) => {
        console.error('[onboarding/generate] voice memories seed failed:', err);
      });
    }
    if (providerKeys && providerKeys.length > 0) {
      await seedIntegrationMemories(ctx, 'byok').catch((err) => {
        console.error('[onboarding/generate] byok memories seed failed:', err);
      });
    }

    // Seed per-agent starter memories for all archetypes
    const agentArchetypes = ['lead', 'reviewer', 'pm', 'designer', 'researcher'];
    await Promise.all(
      agentArchetypes.map((archetype) =>
        seedAgentMemories({ ...ctx, agentArchetype: archetype }).catch((err) => {
          console.error(`[onboarding/generate] ${archetype} agent memories seed failed:`, err);
        }),
      ),
    );
  }

  // Log brain seeded milestone
  if (orgId) {
    await service
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        event_type: 'brain.seeded',
        description: 'Core knowledge and agent memories seeded',
        metadata: { source: 'onboarding' },
      })
      .then(({ error }) => {
        if (error) console.error('[onboarding/generate] brain.seeded milestone failed:', error);
      });
  }

  // Generate personalized CLAUDE.md and store in workspace metadata
  try {
    const { data: wsForName } = await service
      .from('workspaces')
      .select('name, metadata')
      .eq('id', workspaceId)
      .single();

    const claudeMd = generateWorkspaceClaudeMd({
      workspaceName: wsForName?.name ?? 'My Workspace',
      role,
      goal,
      autonomy,
      domain,
    });

    const prevMeta = (wsForName?.metadata as Record<string, unknown>) ?? {};
    await service
      .from('workspaces')
      .update({
        metadata: {
          ...prevMeta,
          claude_md: claudeMd,
          onboarding_completed_at: new Date().toISOString(),
        },
      })
      .eq('id', workspaceId);
  } catch (err) {
    console.error('[onboarding/generate] CLAUDE.md generation failed:', err);
  }

  // Final milestone: onboarding complete
  try {
    await service.from('activity_log').insert({
      workspace_id: workspaceId,
      user_id: userId,
      event_type: 'onboarding.completed',
      description: 'Onboarding pipeline completed successfully',
      metadata: { source: 'onboarding', role, goal, domain },
    });
  } catch (err) {
    console.error('[onboarding/generate] onboarding.completed milestone failed:', err);
  }
}

// ---------------------------------------------------------------------------
// POST handler — Phase 1 (sync): validate + return immediately
//                Phase 2 (async): seed projects, tasks, memories in background
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'onboarding.generate.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch (err) {
      console.error('[onboarding/generate] JSON parse failed:', err);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const bodyParsed = onboardingGenerateSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, agent_id, useCase: useCaseFromBody } = bodyParsed.data;

    // Verify workspace membership before any data access
    const membershipError = await requireWorkspaceMembership(user.id, workspace_id);
    if (membershipError) return membershipError;

    // Get workspace org_id
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('org_id')
      .eq('id', workspace_id)
      .single();
    const orgId = workspace?.org_id ?? null;

    // Read Q&A answers from agent_memory — escape LIKE wildcards in agent_id
    const safeAgentId = (agent_id || '').replace(/[%_]/g, '\\$&');
    const { data: memories } = await supabase
      .from('agent_memory')
      .select('key, content')
      .eq('user_id', user.id)
      .eq('source', 'context-qa')
      .like('key', `context-qa:${safeAgentId || '%'}:%`);

    // Parse Q&A answers and truncate to prevent abuse
    let role = '';
    let goal = '';
    let autonomy = '';
    for (const mem of memories ?? []) {
      const answer = mem.content.split('\nA: ')[1] ?? '';
      if (mem.key.includes('q1-role')) role = answer.slice(0, 200);
      if (mem.key.includes('q2-priority')) goal = answer.slice(0, 500);
      if (mem.key.includes('q3-autonomy')) autonomy = answer.slice(0, 500);
    }

    const domain = (role || 'general').slice(0, 200);
    const detectedUseCase = typeof useCaseFromBody === 'string' ? useCaseFromBody : undefined;
    const goalProjectName = selectTemplate(role, goal).name;

    // --- Phase 2: Fire-and-forget background seeding ---
    // The seeding function uses createServiceClient() so it doesn't depend on
    // the request's auth context. Errors are logged but never surface to the user.
    void seedWorkspaceContent({
      userId: user.id,
      workspaceId: workspace_id,
      orgId,
      agentId: agent_id,
      role,
      goal,
      domain,
      autonomy,
      detectedUseCase,
    }).catch((err) => {
      console.error('[onboarding/generate] background seeding failed:', err);
    });

    // --- Phase 1: Return immediately so the user can see their workspace ---
    return NextResponse.json({
      workspace_id,
      goal_project_name: goalProjectName,
      seeding_status: 'in_progress',
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
