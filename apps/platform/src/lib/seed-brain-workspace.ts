import { createServiceClient } from '@repo/db/service';
import { DOMAIN_DOCS } from '@/lib/branding';

/**
 * Starter memories seeded into the brain workspace on first signup.
 * These are platform-owned system memories that teach users how to use the platform.
 */
const STARTER_MEMORIES = [
  {
    key: 'getting-started:welcome',
    content:
      'Welcome to Celune — your AI-powered workspace. Celune gives you a personal team of AI agents that remember your context, help you manage work, and collaborate with you across every project. Your agents live here and grow smarter the more you use them.',
    category: 'general',
    memory_type: 'context',
    importance_score: 0.9,
  },
  {
    key: 'getting-started:how-agents-work',
    content:
      'How agents work: Each agent in Celune has a distinct personality, archetype, and area of focus. You can chat with agents directly, assign tasks to them, and let them surface relevant context from your memory. Agents remember past conversations and decisions, so they get more useful over time. Your Agent Lead is your primary collaborator — think of it as your AI chief of staff.',
    category: 'general',
    memory_type: 'context',
    importance_score: 0.85,
  },
  {
    key: 'getting-started:memory-best-practices',
    content:
      'Memory best practices: Your Second Brain stores everything agents learn about you. The more context you give, the better agents perform. Add memories explicitly with "Remember that..." or let agents capture them automatically during conversations. Use categories (preference, decision, context, fact) to keep things organized. You can search, edit, and delete memories at any time from the Memory page.',
    category: 'general',
    memory_type: 'context',
    importance_score: 0.8,
  },
  {
    key: 'getting-started:getting-help',
    content: `Getting help: Documentation is at ${DOMAIN_DOCS}. The Support page in the sidebar connects you to the team. You can also ask any agent directly — type your question in the chat panel. For MCP integration (connecting Claude Code to Celune), go to Settings → API Keys and follow the setup guide.`,
    category: 'general',
    memory_type: 'context',
    importance_score: 0.75,
  },
] as const;

/**
 * Creates a brain workspace for the user (idempotent) and seeds it with
 * system-level starter memories that teach the user how to use the platform.
 *
 * Uses createServiceClient() to bypass RLS since these are platform-owned
 * system memories that users cannot edit or delete.
 */
export async function seedBrainWorkspace(params: {
  userId: string;
  orgId: string;
  supabase?: ReturnType<typeof createServiceClient>;
}): Promise<{ brainWorkspaceId: string; memoriesSeeded: number }> {
  const service = params.supabase ?? createServiceClient();

  // 1. Find or create the brain workspace
  const { data: existing } = await service
    .from('workspaces')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('slug', 'brain')
    .maybeSingle();

  let brainWorkspaceId: string;

  if (existing) {
    brainWorkspaceId = existing.id;
  } else {
    const { data: created, error: wsErr } = await service
      .from('workspaces')
      .insert({
        org_id: params.orgId,
        name: 'Second Brain',
        slug: 'brain',
        icon: '🧠',
        is_default: false,
      })
      .select('id')
      .single();

    if (wsErr || !created) {
      throw new Error(`Failed to create brain workspace: ${wsErr?.message ?? 'unknown error'}`);
    }

    brainWorkspaceId = created.id;

    // Add the owner as a workspace member
    await service.from('workspace_memberships').insert({
      user_id: params.userId,
      workspace_id: brainWorkspaceId,
      role: 'owner',
    });
  }

  // 2. Seed starter memories (idempotent — skip keys that already exist)
  const { data: existingMemories } = await service
    .from('agent_memory')
    .select('key')
    .eq('workspace_id', brainWorkspaceId)
    .eq('source', 'system')
    .in(
      'key',
      STARTER_MEMORIES.map((m) => m.key),
    );

  const existingKeys = new Set((existingMemories ?? []).map((m) => m.key));
  const toInsert = STARTER_MEMORIES.filter((m) => !existingKeys.has(m.key));

  if (toInsert.length === 0) {
    return { brainWorkspaceId, memoriesSeeded: 0 };
  }

  const rows = toInsert.map((m) => ({
    key: m.key,
    content: m.content,
    category: m.category,
    source: 'system' as const,
    memory_type: m.memory_type,
    importance_score: m.importance_score,
    user_id: params.userId,
    org_id: params.orgId,
    workspace_id: brainWorkspaceId,
    agent_id: 'system',
    tags: 'getting-started system',
    expires_at: null,
    is_core: true,
  }));

  const { error: memErr } = await service.from('agent_memory').insert(rows);
  if (memErr) {
    throw new Error(`Failed to seed starter memories: ${memErr.message}`);
  }

  return { brainWorkspaceId, memoriesSeeded: toInsert.length };
}
