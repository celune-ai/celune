import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { getAuthUserId, getOrgIdForWorkspace } from '@/lib/auth';
import { seedDefaultAgents } from '@/lib/agent-seed';
import { getStarterMemoriesForTeams } from '@repo/db/starter-memories';
import { seedTeamMemories } from '@/lib/seed-knowledge-packs';
import { seedDefaultSkillPacks } from '@repo/db/skill-loader';

import { applyRateLimit, RATE_AI } from '@/lib/rate-limiter';
import { onboardingConfirmProfileSchema } from '@/lib/schemas/onboarding.schema';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Confirm the onboarding profile and seed the workspace.
 *
 * POST /api/onboarding/confirm-profile
 * Body: {
 *   workspace_id: string,
 *   profile: {
 *     summary: string,
 *     role: string,
 *     goals: string[],
 *     working_style: string,
 *     challenges: string[],
 *     agent_team: Array<{ name: string, role: string, reason: string }>,
 *     suggested_project: {
 *       name: string,
 *       description: string,
 *       tasks: string[]
 *     }
 *   }
 * }
 *
 * Triggers:
 * 1. Store profile summary as agent memory
 * 2. Seed recommended agents
 * 3. Create suggested first project with tasks
 * 4. Seed brain workspace with starter memories
 * 5. Mark onboarding completed in workspace metadata
 */

interface ProfilePayload {
  summary: string;
  role: string;
  goals: string[];
  working_style: string;
  challenges: string[];
  agent_team: Array<{ name: string; role: string; reason: string }>;
  suggested_project: {
    name: string;
    description: string;
    tasks: string[];
  };
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'onboarding.confirm.post', RATE_AI);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const parsed = onboardingConfirmProfileSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, profile } = parsed.data;

    // Verify workspace membership
    const membershipError = await requireWorkspaceMembership(userId, workspace_id);
    if (membershipError) return membershipError;

    const supabase = createServiceClient();
    const orgId = await getOrgIdForWorkspace(workspace_id);

    // 1. Store profile summary as high-importance memory
    const profileMemories = [
      {
        key: 'profile:summary',
        content: profile.summary,
        category: 'context',
        importance_score: 0.95,
      },
      {
        key: 'profile:role',
        content: profile.role,
        category: 'fact',
        importance_score: 0.9,
      },
      {
        key: 'profile:goals',
        content: profile.goals.join('; '),
        category: 'context',
        importance_score: 0.9,
      },
      {
        key: 'profile:working-style',
        content: profile.working_style,
        category: 'preference',
        importance_score: 0.85,
      },
      {
        key: 'profile:challenges',
        content: profile.challenges.join('; '),
        category: 'context',
        importance_score: 0.8,
      },
    ];

    const { error: memoryErr } = await supabase.from('agent_memory').insert(
      profileMemories.map((m) => ({
        ...m,
        workspace_id,
        user_id: userId,
        source: 'onboarding-profile',
        tags: `profile,${m.key.split(':')[1]}`,
      })),
    );
    if (memoryErr) console.error('[confirm-profile] Memory insert failed:', memoryErr.message);

    // 2. Seed agents based on plan tier
    const { plan } = await resolveWorkspacePlan(workspace_id, userId);

    const seedResult = await seedDefaultAgents(workspace_id, plan, userId);

    // 2b. Seed team-specific starter memories based on template category
    if (seedResult.templateCategory) {
      const starterMemories = getStarterMemoriesForTeams([seedResult.templateCategory]);
      if (starterMemories.length > 0) {
        await supabase.from('agent_memory').insert(
          starterMemories.map((m) => ({
            key: m.key,
            content: m.content,
            category: m.category,
            memory_type: m.memory_type,
            importance_score: m.importance_score,
            source: 'onboarding-seed',
            tags: 'starter,best-practice',
            workspace_id,
            user_id: userId,
          })),
        );
      }
    }

    // 2c. Seed template + role-specific memories for the matched team
    if (seedResult.templateId && orgId) {
      // Extract agent roles from the template's agents
      const agentRoles = seedResult.agentIds ?? [];
      await seedTeamMemories({
        userId,
        orgId,
        workspaceId: workspace_id,
        templateId: seedResult.templateId,
        agentRoles,
      }).catch((err) => {
        console.error('[confirm-profile] team memories seed failed:', err);
      });
    }

    // 2d. Seed default skill packs based on team type and plan
    const skillPackResult = await seedDefaultSkillPacks(
      workspace_id,
      plan,
      userId,
      seedResult.templateCategory ?? undefined,
    ).catch((err) => {
      console.error('[confirm-profile] skill pack seed failed:', err);
      return { installed: 0, packSlugs: [] as string[] };
    });

    // 3. Create suggested first project with tasks
    let projectId: string | null = null;
    if (profile.suggested_project) {
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .insert({
          name: profile.suggested_project.name,
          description: profile.suggested_project.description,
          project_type: 'feature',
          project_status: 'active',
          workspace_id,
          org_id: orgId,
          user_id: userId,
        })
        .select('id')
        .single();

      if (!projErr && project) {
        projectId = project.id;

        const taskRows = profile.suggested_project.tasks.map((title, i) => ({
          title: title.slice(0, 70), // enforce 70 char max
          description: `## What\n${title}\n\n## Approach\nTo be defined during planning.`,
          status: 'inbox' as const,
          priority: i < 2 ? 'high' : ('normal' as string),
          project_id: project.id,
          workspace_id,
          org_id: orgId,
          user_id: userId,
          sort_order: i,
          metadata: {
            is_template_task: true,
            onboarding_project_type: 'suggested',
          },
        }));

        const { error: taskErr } = await supabase.from('tasks').insert(taskRows);
        if (taskErr) console.error('[confirm-profile] Task insert failed:', taskErr.message);
      }
    }

    // 4. Mark onboarding completed in workspace metadata
    const { data: ws } = await supabase
      .from('workspaces')
      .select('metadata')
      .eq('id', workspace_id)
      .single();
    const prevMeta = (ws?.metadata as Record<string, unknown>) ?? {};
    await supabase
      .from('workspaces')
      .update({
        metadata: { ...prevMeta, onboarding_completed_at: new Date().toISOString() },
      })
      .eq('id', workspace_id);

    return NextResponse.json({
      success: true,
      agents_seeded: seedResult.seeded,
      project_id: projectId,
      skill_packs_installed: skillPackResult.installed,
      skill_pack_slugs: skillPackResult.packSlugs,
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
