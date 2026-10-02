import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { getAuthUserId, getOrgIdForWorkspace } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { applyRateLimit, RATE_AI, RATE_READ } from '@/lib/rate-limiter';
import { getManifestForTier, computeContentHash } from '@repo/db/brain-manifest-registry';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { seedDefaultAgents } from '@/lib/agent-seed';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import { resolveProviderKey, type KeySource } from '@/lib/resolve-provider-key';
import { recordLlmUsage } from '@/lib/ai-budget';
import { seedCoreKnowledge, seedAgentMemories, seedTeamMemories } from '@/lib/seed-knowledge-packs';
import { getKnowledgeContextForProjectGeneration } from '@/lib/knowledge/onboarding-context';

import type { Plan } from '@repo/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/onboarding/generate-projects
//
// Generates 2-3 personalized projects (with tasks) from onboarding memories.
// Uses the platform Anthropic key — cost is absorbed for all users.
// ---------------------------------------------------------------------------

const PROJECT_GENERATION_PROMPT = `You are an elite project strategist who helps people unlock the full power of AI agent teams. Based on the user's onboarding memories, generate exactly 3 personalized starter projects.

## Project Mix (MANDATORY — always generate exactly these 3)

**Project 1 — Action Plan** (project_type: "plan")
Their primary goal turned into a structured execution plan. Mix of:
- 2-3 USER tasks: tactical, checkbox-style items THEY do (review, decide, approve, configure)
- 2-3 AGENT tasks: heavy lifting the Lead agent executes (research, draft, build, analyze)

**Project 2 — Deep Research** (project_type: "research")
A research investigation the user can kick off and get deliverables back. This is the "magic moment" — they tell their agent team to go research something, and they come back with a structured report.
- 1 USER task: define the research questions or review scope
- 3-4 AGENT tasks: investigate, analyze, synthesize, produce deliverable
- The final agent task should be "Compile research findings into deliverable"

**Project 3 — Quick Wins** (project_type: "plan")
3-4 immediately actionable items that show value fast. Mix of user tactical items and agent-powered automation.
- 2 USER tasks: quick decisions or configurations
- 1-2 AGENT tasks: things the agent can knock out right now

## Task Assignment Rules

Every task MUST have an "assignee" field:
- "user" — the human does this (tactical: review, decide, approve, configure, set up)
- "lead" — the Lead agent does this (code, build, draft, implement, architect)
- "researcher" — the Researcher agent does this (investigate, analyze, compare, survey)
- "reviewer" — the Code Reviewer agent does this (audit, review, QA, test)
- "pm" — the PM agent does this (write PRD, scope, plan, prioritize, synthesize)

USER tasks should feel like a power-user checklist — crisp, tactical, satisfying to check off.
AGENT tasks should feel ambitious — things that would take the user hours but the agent can tackle autonomously.

## Task Description Quality (CRITICAL)

Task descriptions are the user's FIRST impression of their agent team's intelligence. Write them like a smart colleague would — conversational but specific, no boilerplate headers.

For USER tasks, write 2-3 sentences explaining what they need to do and why, then a clean checklist:
- [ ] Step 1 (specific action)
- [ ] Step 2
- [ ] Step 3

For AGENT tasks, write 2-3 paragraphs in natural prose:
- Paragraph 1: What the agent will do and why it matters for this user specifically
- Paragraph 2: The approach — specific steps, methodologies, or frameworks the agent will use
- Paragraph 3: What the user gets back — the deliverable, format, and how to use it

Do NOT use markdown headers (## What, ## Approach, etc.) inside task descriptions. Write flowing prose instead. The task title already says WHAT — the description explains HOW and WHY.

For research tasks, weave 2-3 specific research questions naturally into the description rather than listing them under a header.

## Rules
- Project names must be specific to the user's situation, goals, and domain
- Task titles must be under 70 characters, imperative voice
- NEVER use generic names like "Getting Started" or "Setup Project"
- Reference the user's actual role, domain, tools, stack, or goals in every title
- If they mentioned a specific product/project, make Project 1 about that
- Research projects should investigate something the user would genuinely want to know
- Agent task descriptions should be 2-3x longer than user task descriptions — agents need detailed instructions
- Include concrete examples, frameworks, or methodologies in agent task descriptions
- For code-related users: reference their actual tech stack in tasks

Return ONLY valid JSON:
{
  "projects": [
    {
      "name": "Project Name — specific to user",
      "description": "2-3 sentences. What this project accomplishes and why it matters for them specifically.",
      "project_type": "plan",
      "tasks": [
        {
          "title": "Task title (imperative, ≤70 chars)",
          "description": "Full structured description per format above",
          "priority": "high",
          "assignee": "user"
        }
      ]
    }
  ]
}

Priorities: urgent (max 1 total), high, normal, low.`;

interface GeneratedProject {
  name: string;
  description: string;
  project_type?: string;
  tasks: Array<{
    title: string;
    description: string;
    priority: string;
    assignee?: string;
  }>;
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(
    request,
    'onboarding.generate-projects.post',
    RATE_AI,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const workspaceId = body?.workspace_id;
    if (!workspaceId || typeof workspaceId !== 'string') {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    // Verify membership
    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();
    const orgId = await getOrgIdForWorkspace(workspaceId);

    // Set generation status to pending
    const { data: ws } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspaceId)
      .single();

    const prevMeta = (ws?.metadata as Record<string, unknown>) ?? {};
    await supabase
      .from('workspaces')
      .update({
        metadata: {
          ...prevMeta,
          onboarding_generation_status: 'pending',
        },
      })
      .eq('id', workspaceId);

    // Fetch onboarding memories
    const { data: memories, error: memError } = await supabase
      .from('agent_memory')
      .select('key, content, category')
      .eq('workspace_id', workspaceId)
      .like('source', '%onboarding%')
      .order('created_at', { ascending: true });

    if (memError) {
      console.error('[generate-projects] Failed to fetch memories:', memError.message);
      return NextResponse.json({ error: 'Failed to fetch onboarding data' }, { status: 500 });
    }

    let memoryContext: string;

    if (memories && memories.length > 0) {
      memoryContext = memories.map((m) => `[${m.category}] ${m.key}: ${m.content}`).join('\n');
    } else {
      // Fallback: pull raw conversation messages from conversation_logs
      console.warn(
        '[generate-projects] No agent_memory entries found — falling back to conversation messages',
      );
      const { data: convLog } = await supabase
        .from('conversation_logs')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('source', 'onboarding')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (convLog) {
        const { data: convMessages } = await supabase
          .from('conversation_messages')
          .select('role, content')
          .eq('conversation_id', convLog.id)
          .order('created_at', { ascending: true });

        if (convMessages && convMessages.length > 1) {
          memoryContext = convMessages
            .filter((m) => !(m.role === 'user' && m.content === 'Hi'))
            .map((m) => `[${m.role}] ${m.content.replace(/\[MEMORY:[^\]]+\]/g, '').trim()}`)
            .join('\n\n');
        } else {
          await supabase
            .from('workspaces')
            .update({
              metadata: {
                ...prevMeta,
                onboarding_generation_status: 'error',
                onboarding_generation_error: 'No onboarding data found',
              },
            })
            .eq('id', workspaceId);

          return NextResponse.json(
            {
              status: 'error',
              error: 'No onboarding data found. Complete the onboarding chat first.',
            },
            { status: 400 },
          );
        }
      } else {
        await supabase
          .from('workspaces')
          .update({
            metadata: {
              ...prevMeta,
              onboarding_generation_status: 'error',
              onboarding_generation_error: 'No onboarding conversation found',
            },
          })
          .eq('id', workspaceId);

        return NextResponse.json(
          { status: 'error', error: 'No onboarding conversation found. Complete the chat first.' },
          { status: 400 },
        );
      }
    }

    // Resolve API key through the BYOK chain; the resolver owns any host fallback.
    let anthropicApiKey: string;
    let keySource: KeySource = 'platform';

    try {
      if (!orgId) throw new Error('Workspace has no organization');
      const resolved = await resolveProviderKey('anthropic', orgId, workspaceId, { userId });
      anthropicApiKey = resolved.key;
      keySource = resolved.source;
    } catch {
      await updateGenerationStatus(
        supabase,
        workspaceId,
        prevMeta,
        'error',
        'No API key configured',
      );
      return NextResponse.json({ error: 'AI generation unavailable' }, { status: 503 });
    }

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    // Fetch KB context to inform project generation
    const kbContext = await getKnowledgeContextForProjectGeneration(workspaceId);

    let response;
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        system: PROJECT_GENERATION_PROMPT + kbContext,
        messages: [
          {
            role: 'user',
            content: `Here are the user's onboarding memories:\n\n${memoryContext}\n\n${kbContext ? 'You also have access to their connected knowledge base content (included in the system prompt). Use BOTH the conversation memories AND the KB content to generate highly specific, relevant projects.\n\n' : ''}Generate exactly 3 personalized projects (1 action plan, 1 deep research, 1 quick wins) based on what you know about this user. Make the research project something they'd genuinely want investigated — competitive landscape, best practices, technology evaluation, market analysis, etc. Make agent task descriptions detailed and rich — these are instructions the agent will actually follow.`,
          },
        ],
      });
      recordLlmUsage({
        workspaceId,
        orgId,
        userId,
        provider: 'anthropic',
        model: response.model,
        source: keySource,
        feature: 'onboarding_generate_projects',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    } catch (apiErr: unknown) {
      const errMsg = apiErr instanceof Error ? apiErr.message : 'AI provider error';
      const isBilling =
        errMsg.includes('credit balance') ||
        errMsg.includes('billing') ||
        errMsg.includes('payment');
      const userMessage = isBilling
        ? 'Your API key has insufficient credits. Please add credits to your AI provider account.'
        : `AI provider error: ${errMsg}`;
      await updateGenerationStatus(supabase, workspaceId, prevMeta, 'error', userMessage);
      return NextResponse.json(
        { status: 'error', error: userMessage, provider_key_error: isBilling },
        { status: isBilling ? 402 : 502 },
      );
    }

    const responseText = response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Parse the generated projects
    const jsonMatch = responseText.match(/\{[\s\S]*"projects"[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[generate-projects] Failed to parse AI response:', responseText.slice(0, 200));
      await updateGenerationStatus(
        supabase,
        workspaceId,
        prevMeta,
        'error',
        'Failed to parse AI response',
      );
      return NextResponse.json(
        { status: 'error', error: 'Failed to generate projects' },
        { status: 500 },
      );
    }

    let generated: { projects: GeneratedProject[] };
    try {
      generated = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('[generate-projects] JSON parse failed');
      await updateGenerationStatus(
        supabase,
        workspaceId,
        prevMeta,
        'error',
        'Invalid JSON from AI',
      );
      return NextResponse.json(
        { status: 'error', error: 'Failed to parse generated projects' },
        { status: 500 },
      );
    }

    // Create projects and tasks in Supabase
    const createdProjects: Array<{ id: string; name: string; task_count: number }> = [];

    // Map AI assignee labels to actual agent IDs from the seeded roster
    const ASSIGNEE_MAP: Record<string, string> = {
      user: 'unassigned', // user tasks stay unassigned — they claim them
      lead: 'rick',
      researcher: 'delv',
      reviewer: 'scan',
      pm: 'sage',
      designer: 'noir',
    };

    const validProjectTypes = new Set(['feature', 'plan', 'research', 'system']);

    for (const project of generated.projects.slice(0, 3)) {
      const projectType = validProjectTypes.has(project.project_type ?? '')
        ? project.project_type!
        : 'plan';

      const { data: created, error: projError } = await supabase
        .from('projects')
        .insert({
          name: project.name.slice(0, 200),
          description: project.description,
          project_type: projectType,
          status: 'active',
          workspace_id: workspaceId,
          org_id: orgId,
          user_id: userId,
        })
        .select('id, name')
        .single();

      if (projError || !created) {
        console.error('[generate-projects] Project insert failed:', projError?.message);
        continue;
      }

      // Create tasks for this project
      const validPriorities = new Set(['urgent', 'high', 'normal', 'low']);
      const taskRows = project.tasks.slice(0, 6).map((task, i) => ({
        title: task.title.slice(0, 200),
        description: (task.description ?? '').slice(0, 10000),
        status: 'inbox' as const,
        priority: validPriorities.has(task.priority) ? task.priority : 'normal',
        assignee: ASSIGNEE_MAP[task.assignee ?? 'user'] ?? 'unassigned',
        project_id: created.id,
        workspace_id: workspaceId,
        org_id: orgId,
        user_id: userId,
        sort_order: i,
        metadata: {
          is_template_task: true,
          onboarding_project_type: projectType === 'research' ? 'research' : 'generated',
          source: 'onboarding',
          assigned_role: task.assignee ?? 'user',
        },
      }));

      if (taskRows.length > 0) {
        const { error: taskError } = await supabase.from('tasks').insert(taskRows);
        if (taskError) {
          console.error('[generate-projects] Task insert failed:', taskError.message);
        }
      }

      // Auto-generate brief for non-engineering project types
      // Engineering/system projects get PRDs via agent R&D flow; others get auto-briefs
      const needsBrief = projectType !== 'system';
      if (needsBrief && taskRows.length > 0) {
        // Strip any HTML tags from AI-generated content to prevent XSS
        const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '');

        // Extract just the first meaningful sentence from each task description
        const extractSummary = (desc: string | null): string => {
          if (!desc) return '';
          // Skip markdown headers and get the first real content line
          const lines = desc.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
          return lines[0]?.trim() ?? '';
        };

        // Split tasks into user vs agent work
        const userTasks = taskRows.filter((t) => t.assignee === 'unassigned');
        const agentTasks = taskRows.filter((t) => t.assignee !== 'unassigned');

        const formatTask = (t: (typeof taskRows)[0]) => {
          const summary = extractSummary(t.description);
          return `- **${stripHtml(t.title)}**${summary ? ` — ${stripHtml(summary)}` : ''}`;
        };

        const sections: string[] = [stripHtml(project.description), ``];

        if (userTasks.length > 0) {
          sections.push(`## What you'll do`, ``, ...userTasks.map(formatTask), ``);
        }

        if (agentTasks.length > 0) {
          sections.push(`## What your agents will handle`, ``, ...agentTasks.map(formatTask), ``);
        }

        sections.push(
          `---`,
          ``,
          `*${taskRows.length} tasks total — ${userTasks.length} for you, ${agentTasks.length} for your agent team.*`,
        );

        const briefContent = sections.join('\n');

        await supabase
          .from('projects')
          .update({
            prd_content: briefContent,
            prd_metadata: {
              author: 'system',
              status: 'draft',
              agents_involved: [],
              created_date: new Date().toISOString().split('T')[0],
            },
          })
          .eq('id', created.id);
      }

      createdProjects.push({
        id: created.id,
        name: created.name,
        task_count: taskRows.length,
      });
    }

    // Seed brain manifest for the workspace (skills, hooks, agents)
    await seedBrainManifest(supabase, workspaceId);

    // Seed core knowledge memories so IDE agents have useful platform context
    await seedCoreKnowledgeMemories(supabase, workspaceId, userId);

    // Seed full knowledge packs + agent memories (idempotent — skips existing keys)
    if (orgId) {
      const seedCtx = { userId, orgId, workspaceId };

      await seedCoreKnowledge(seedCtx).catch((err) => {
        console.error('[generate-projects] core knowledge seed failed:', err);
      });

      const agentArchetypes = ['lead', 'reviewer', 'pm', 'designer', 'researcher'];
      await Promise.all(
        agentArchetypes.map((archetype) =>
          seedAgentMemories({ ...seedCtx, agentArchetype: archetype }).catch((err) => {
            console.error(`[generate-projects] ${archetype} agent memories seed failed:`, err);
          }),
        ),
      );
    }

    // Seed default agents so the readiness gate passes
    try {
      const { plan } = await resolveWorkspacePlan(workspaceId, userId);
      const seedResult = await seedDefaultAgents(workspaceId, plan as Plan, userId);

      // Seed template + role memories for the matched team
      if (seedResult.templateId && orgId) {
        await seedTeamMemories({
          userId,
          orgId,
          workspaceId,
          templateId: seedResult.templateId,
          agentRoles: seedResult.agentIds ?? [],
        }).catch((err) => {
          console.error('[generate-projects] team memories seed failed:', err);
        });
      }
    } catch (err) {
      // Non-fatal — workspace is still usable without agents
      console.error('[generate-projects] Agent seeding error:', err);
    }

    // Update workspace metadata with completion status
    const { data: latestWs } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspaceId)
      .single();
    const latestMeta = (latestWs?.metadata as Record<string, unknown>) ?? {};

    await supabase
      .from('workspaces')
      .update({
        metadata: {
          ...latestMeta,
          onboarding_generation_status: 'complete',
          onboarding_generation_pending: false,
          onboarding_generation_completed_at: new Date().toISOString(),
          onboarding_generated_project_ids: createdProjects.map((p) => p.id),
        },
      })
      .eq('id', workspaceId);

    return NextResponse.json({
      status: 'complete',
      projects: createdProjects,
    });
  } catch (error) {
    console.error('[generate-projects] Unexpected error:', error);
    return safeErrorResponse(error);
  }
}

// ---------------------------------------------------------------------------
// GET /api/onboarding/generate-projects?workspace_id=...
//
// Returns the current generation status from workspace metadata.
// Used by the dashboard to poll for completion.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(
    request,
    'onboarding.generate-projects.get',
    RATE_READ,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();
    const { data: ws } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspaceId)
      .single();

    const metadata = (ws?.metadata as Record<string, unknown>) ?? {};

    return NextResponse.json({
      status: metadata.onboarding_generation_status ?? 'none',
      pending: metadata.onboarding_generation_pending ?? false,
      completed_at: metadata.onboarding_generation_completed_at ?? null,
      project_ids: metadata.onboarding_generated_project_ids ?? [],
      error: metadata.onboarding_generation_error ?? null,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a brain file path and verify it doesn't escape the base directory. */
function safeBrainPath(baseDir: string, filePath: string): string | null {
  // Only allow alphanumeric, forward slashes, dots, hyphens, underscores
  if (!/^[a-zA-Z0-9/_.-]+$/.test(filePath)) return null;
  const resolved = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) return null;
  return resolved;
}

/** Seed brain_manifest rows so the Skills page shows installed items. */
async function seedBrainManifest(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
) {
  try {
    const manifestEntries = getManifestForTier();
    const now = new Date().toISOString();
    const coreBrainDir = join(process.cwd(), '..', '..', 'packages', 'brain', 'core');

    const manifestRows = manifestEntries.map((entry) => {
      let contentHash = computeContentHash('');
      try {
        const coreFilePath = safeBrainPath(coreBrainDir, entry.path);
        if (coreFilePath && !entry.path.endsWith('/') && existsSync(coreFilePath)) {
          const content = readFileSync(coreFilePath, 'utf8');
          contentHash = computeContentHash(content);
        }
      } catch {
        // Fall back to empty hash
      }
      return {
        workspace_id: workspaceId,
        path: entry.path,
        content_hash: contentHash,
        version: entry.version,
        tier: entry.tier,
        category: entry.category,
        is_core: entry.isCore,
        is_forked: false,
        update_available: false,
        update_summary: null,
        created_at: now,
        updated_at: now,
      };
    });

    if (manifestRows.length > 0) {
      const { error } = await supabase
        .from('brain_manifest')
        .upsert(manifestRows, { onConflict: 'workspace_id,path' });

      if (error) {
        console.error('[generate-projects] Failed to seed brain_manifest:', error);
      } else {
        console.log(
          `[generate-projects] Seeded ${manifestRows.length} brain manifest entries for workspace ${workspaceId}`,
        );
      }
    }
  } catch (err) {
    // Non-fatal — workspace is still usable without manifest rows
    console.error('[generate-projects] Brain manifest seeding error:', err);
  }
}

/** Core knowledge memories seeded into every new workspace so IDE agents have platform context. */
const CORE_KNOWLEDGE_MEMORIES: Array<{
  key: string;
  category: string;
  content: string;
  importance: number;
}> = [
  {
    key: 'platform:overview',
    category: 'context',
    content:
      'Celune is an AI-powered project management platform. It combines task management, AI agent orchestration, and persistent memory to help users ship faster. The platform has workspaces, projects, tasks, agents, and a skill library.',
    importance: 0.9,
  },
  {
    key: 'platform:task-system',
    category: 'fact',
    content:
      'Tasks have 7 statuses: backlog, inbox, assigned, planning, in_progress, review, done. Tasks support subtasks, dependencies (depends_on), comments, attachments, and metadata. Priority levels: urgent, high, normal, low. Every task belongs to a workspace and optionally a project.',
    importance: 0.9,
  },
  {
    key: 'platform:project-system',
    category: 'fact',
    content:
      'Projects group related tasks. Types: feature (product work), system (platform health), research (investigation), plan (roadmaps). Projects have PRDs, status tracking, and a closing gate sequence: Code Review → Design Feedback → Retrospective.',
    importance: 0.85,
  },
  {
    key: 'platform:agent-system',
    category: 'fact',
    content:
      'The workspace has AI agents that can be configured with different roles, personalities, and capabilities. Agents can claim tasks, write code, review PRs, and communicate via the platform. Each agent has a configurable voice for TTS.',
    importance: 0.85,
  },
  {
    key: 'platform:memory-system',
    category: 'fact',
    content:
      'Agent memory persists key-value entries across sessions. Memories have categories (preference, decision, context, fact), importance scores, and full-text search. Memories help agents maintain context about the user and workspace.',
    importance: 0.85,
  },
  {
    key: 'platform:skills',
    category: 'fact',
    content:
      'Skills are slash commands and automated workflows. Slash commands are user-invoked (e.g., /build, /project, /task). Automated workflows trigger on events. Skills are managed via the brain manifest and can be core (system-provided) or custom.',
    importance: 0.8,
  },
  {
    key: 'platform:mcp-integration',
    category: 'fact',
    content:
      'The platform exposes an MCP (Model Context Protocol) server at /api/mcp. IDE tools like Cursor and Claude Code can connect to read tasks, projects, memories, and create new items. MCP tools have read and write scopes.',
    importance: 0.8,
  },
  {
    key: 'platform:tech-stack',
    category: 'fact',
    content:
      'Built with Next.js (App Router), React, TypeScript, Tailwind CSS, Supabase (PostgreSQL), and Turborepo. UI uses shadcn/ui + Radix primitives. AI integration via Anthropic SDK. Monorepo with shared packages: @repo/ui, @repo/types, @repo/db.',
    importance: 0.7,
  },
];

/** Seed core knowledge memories so IDE agents have useful workspace context. */
async function seedCoreKnowledgeMemories(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  userId: string,
) {
  try {
    const rows = CORE_KNOWLEDGE_MEMORIES.map((m) => ({
      workspace_id: workspaceId,
      user_id: userId,
      key: m.key,
      content: m.content,
      category: m.category,
      source: 'brain-seed',
      agent_id: 'system',
      memory_type: 'fact',
      is_core: true,
      importance_score: m.importance,
      tags: 'core,platform,onboarding',
    }));

    const { error } = await supabase
      .from('agent_memory')
      .upsert(rows, { onConflict: 'workspace_id,key' });

    if (error) {
      console.error('[generate-projects] Failed to seed core memories:', error.message);
    } else {
      console.log(
        `[generate-projects] Seeded ${rows.length} core knowledge memories for workspace ${workspaceId}`,
      );
    }
  } catch (err) {
    // Non-fatal — workspace is still usable without seed memories
    console.error('[generate-projects] Core memory seeding error:', err);
  }
}

async function updateGenerationStatus(
  supabase: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  prevMeta: Record<string, unknown>,
  status: string,
  errorMsg?: string,
) {
  await supabase
    .from('workspaces')
    .update({
      metadata: {
        ...prevMeta,
        onboarding_generation_status: status,
        ...(errorMsg ? { onboarding_generation_error: errorMsg } : {}),
      },
    })
    .eq('id', workspaceId);
}
