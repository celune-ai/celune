/**
 * GET /api/agents/team-templates
 *
 * Returns the full team template library for the marketplace UI.
 * Supports optional ?category= filter and ?search= query.
 *
 * POST /api/agents/team-templates
 *
 * Seeds agents from a team template into a workspace.
 * Body: { workspace_id: string, template_id: string }
 */

import { type NextRequest, NextResponse } from 'next/server';
import {
  TEAM_TEMPLATES,
  TEAM_CATEGORIES,
  getTemplatesByCategory,
  getTeamTemplate,
  getLibraryStats,
  type TeamCategory,
} from '@repo/db/team-templates';
import { createServiceClient } from '@repo/db/service';
import { maxActiveAgentsForPlan, CATEGORY_TO_POD } from '@/lib/agent-seed';
import { resolveWorkspacePlan } from '@/lib/plan-enforcement';
import type { Plan } from '@repo/types';
import { RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET — browse templates
// ---------------------------------------------------------------------------

export const GET = withApiSecurity(
  async (request: NextRequest) => {
    const url = new URL(request.url);
    const category = url.searchParams.get('category') as TeamCategory | null;
    const search = url.searchParams.get('search');

    let templates = TEAM_TEMPLATES;

    if (category && category in TEAM_CATEGORIES) {
      templates = getTemplatesByCategory(category);
    }

    if (search) {
      const q = search.toLowerCase();
      templates = templates.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return NextResponse.json({
      templates,
      categories: TEAM_CATEGORIES,
      stats: getLibraryStats(),
    });
  },
  {
    rateLimit: { tier: RATE_READ, routeKey: 'agents.team-templates.get' },
    csrf: false,
  },
);

// ---------------------------------------------------------------------------
// POST — seed agents from a template
// ---------------------------------------------------------------------------

const seedSchema = z.object({
  workspace_id: z.string().uuid(),
  template_id: z.string().min(1),
});

type SeedBody = z.infer<typeof seedSchema>;

export const POST = withApiSecurity<SeedBody>(
  async (_request: NextRequest, { userId, body }: SecurityContext<SeedBody>) => {
    const { workspace_id, template_id } = body;

    const template = getTeamTemplate(template_id);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const supabase = createServiceClient();

    // Verify workspace membership
    const { data: membership } = await supabase
      .from('workspace_memberships')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', workspace_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Fetch existing agents to avoid duplicates and icon collisions
    const { data: existing } = await supabase
      .from('agent_configs')
      .select('agent_id, icon')
      .eq('workspace_id', workspace_id);

    const existingIds = new Set((existing ?? []).map((r: { agent_id: string }) => r.agent_id));
    const usedIcons = new Set(
      (existing ?? []).map((r: { icon?: string | null }) => r.icon).filter(Boolean),
    );

    // Determine plan tier to enforce active agent limits
    const resolved = await resolveWorkspacePlan(workspace_id, userId);
    const plan = resolved.plan as Plan;
    const maxActive = resolved.limits.max_agents ?? 999;

    // Count currently active agents in the workspace
    const { count: currentActive } = await supabase
      .from('agent_configs')
      .select('agent_id', { count: 'exact', head: true })
      .eq('workspace_id', workspace_id)
      .eq('is_active', true);

    let activeSlots = currentActive ?? 0;

    // Skip the generic 'lead' agent — the user's onboarding agent is the team lead.
    // Only seed supporting team members from the template.
    const newAgents = template.agents.filter(
      (a) => a.agent_id !== 'lead' && !existingIds.has(a.agent_id),
    );

    // Build shuffled avatar pool excluding already-used icons
    const availableAvatars: string[] = [];
    for (let i = 1; i <= 35; i++) {
      const path = `/avatars/Shape_${i}.png`;
      if (!usedIcons.has(path)) availableAvatars.push(path);
    }
    for (let i = availableAvatars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableAvatars[i], availableAvatars[j]] = [availableAvatars[j], availableAvatars[i]];
    }

    // Infer pod from template category
    const pod = CATEGORY_TO_POD[template.category] ?? 'general';

    const toInsert = newAgents.map((a, idx) => {
      // Only activate if under the plan limit; respect template priority order
      const shouldActivate = activeSlots < maxActive;
      if (shouldActivate) activeSlots++;

      return {
        workspace_id,
        agent_id: a.agent_id,
        display_name: a.display_name,
        role: a.role,
        description: a.description,
        agent_type: 'ai' as const,
        model: a.model,
        color: a.color,
        icon: availableAvatars[idx] ?? null,
        pod,
        persona_prompt: a.persona_prompt,
        capabilities: [],
        parameters: a.parameters,
        permissions: a.permissions,
        user_id: userId,
        is_active: shouldActivate,
      };
    });

    if (toInsert.length === 0) {
      return NextResponse.json({
        seeded: 0,
        skipped: template.agents.length,
        template: template.name,
        message: 'All agents from this template already exist in the workspace',
      });
    }

    const { error } = await supabase.from('agent_configs').insert(toInsert);

    if (error) {
      console.error('Failed to seed agents from template:', error.message);
      return NextResponse.json(
        { error: 'Failed to generate team. Please try again.' },
        { status: 500 },
      );
    }

    // Return the seeded agents
    const { data: seededAgents } = await supabase
      .from('agent_configs')
      .select('agent_id, display_name, role, description, model, color')
      .eq('workspace_id', workspace_id)
      .eq('is_active', true);

    return NextResponse.json(
      {
        agents: seededAgents ?? [],
        template: template.name,
        seeded: toInsert.length,
        skipped: template.agents.length - toInsert.length,
      },
      { status: 201 },
    );
  },
  {
    rateLimit: { tier: RATE_WRITE, routeKey: 'agents.team-templates.post' },
    permission: 'agents:configure',
    parseBody: seedSchema,
  },
);
