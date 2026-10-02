/**
 * Context Assembler for Agent Execution
 *
 * Assembles the full execution context for an agent worker:
 * - Agent personality from agent_configs
 * - Task description + metadata
 * - Parent project PRD + related tasks
 * - Workspace memory entries
 * - Conversation history from task comments
 */

import { createServiceClient } from '@repo/db/service';

interface AssembledContext {
  systemPrompt: string;
  userMessage: string;
  metadata: Record<string, unknown>;
}

interface AssembleOptions {
  workspaceId: string;
  taskId: string;
  agentId: string;
  projectId?: string | null;
}

/**
 * Assemble the full context for an agent execution.
 */
export async function assembleExecutionContext(opts: AssembleOptions): Promise<AssembledContext> {
  const supabase = createServiceClient();

  // Fetch task details
  const { data: task } = await supabase
    .from('tasks')
    .select(
      'id, title, description, outcome, status, priority, assignee, metadata, depends_on, effort, category',
    )
    .eq('id', opts.taskId)
    .eq('workspace_id', opts.workspaceId)
    .single();

  if (!task) throw new Error(`Task ${opts.taskId} not found`);

  // Fetch agent config
  const { data: agentConfig } = await supabase
    .from('agent_configs')
    .select('agent_name, display_name, persona, system_prompt, permissions, model_preferences')
    .eq('workspace_id', opts.workspaceId)
    .eq('agent_name', opts.agentId)
    .maybeSingle();

  // Fetch project context if available
  let projectContext = '';
  if (opts.projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('name, description, prd_content, project_type')
      .eq('id', opts.projectId)
      .eq('workspace_id', opts.workspaceId)
      .single();

    if (project) {
      projectContext = `\n## Project: ${project.name}\n`;
      if (project.description) projectContext += `${project.description}\n`;
      if (project.prd_content) {
        // Include a truncated PRD to stay within budget
        const prd = project.prd_content as string;
        projectContext += `\n### PRD\n${prd.slice(0, 4000)}${prd.length > 4000 ? '\n[PRD truncated...]' : ''}\n`;
      }
    }

    // Fetch sibling tasks for awareness
    const { data: siblings } = await supabase
      .from('tasks')
      .select('id, title, status, assignee, metadata')
      .eq('project_id', opts.projectId)
      .neq('id', opts.taskId)
      .order('created_at', { ascending: true })
      .limit(20);

    if (siblings && siblings.length > 0) {
      projectContext += '\n### Related Tasks\n';
      for (const s of siblings) {
        const meta = (s.metadata ?? {}) as Record<string, unknown>;
        projectContext += `- [${s.status}] ${s.title} (sprint ${meta.sprint ?? '?'}, assigned: ${s.assignee})\n`;
      }
    }
  }

  // Fetch recent task comments as conversation history
  let conversationHistory = '';
  const { data: comments } = await supabase
    .from('task_comments')
    .select('author, content, created_at')
    .eq('task_id', opts.taskId)
    .order('created_at', { ascending: true })
    .limit(10);

  if (comments && comments.length > 0) {
    conversationHistory = '\n## Prior Discussion\n';
    for (const c of comments) {
      conversationHistory += `**${c.author}** (${new Date(c.created_at).toLocaleString()}):\n${c.content}\n\n`;
    }
  }

  // Fetch relevant workspace memories
  let memoryContext = '';
  const { data: memories } = await supabase
    .from('agent_memory')
    .select('title, content, category')
    .eq('workspace_id', opts.workspaceId)
    .in('category', ['decision', 'preference', 'context'])
    .order('updated_at', { ascending: false })
    .limit(10);

  if (memories && memories.length > 0) {
    memoryContext = '\n## Workspace Knowledge\n';
    for (const m of memories) {
      memoryContext += `- **${m.title}** [${m.category}]: ${(m.content as string).slice(0, 200)}\n`;
    }
  }

  // Build system prompt
  const agentPersona = agentConfig?.persona ?? agentConfig?.system_prompt ?? '';
  const agentName = agentConfig?.display_name ?? opts.agentId.toUpperCase();

  const systemPrompt = [
    `You are ${agentName}, an AI agent working autonomously on the Celune platform.`,
    agentPersona ? `\n## Personality\n${agentPersona}` : '',
    '\n## Rules',
    '- Complete the assigned task thoroughly and report your outcome.',
    '- Be concise and focused. Do not over-engineer.',
    '- If you encounter a blocker you cannot resolve, report it clearly.',
    '- Track your progress via tool calls.',
    projectContext,
    memoryContext,
  ]
    .filter(Boolean)
    .join('\n');

  // Build user message
  const taskMeta = (task.metadata ?? {}) as Record<string, unknown>;
  const userMessage = [
    `## Your Task: ${task.title}`,
    '',
    task.description ?? 'No description provided.',
    '',
    `**Priority:** ${task.priority}`,
    `**Effort:** ${task.effort ?? 'unknown'}`,
    taskMeta.sprint ? `**Sprint:** ${taskMeta.sprint}` : '',
    conversationHistory,
    '',
    'Complete this task and report your outcome.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return {
    systemPrompt,
    userMessage,
    metadata: {
      agent_name: opts.agentId,
      agent_display_name: agentName,
      model_preferences: agentConfig?.model_preferences ?? null,
      permissions: agentConfig?.permissions ?? null,
      task_priority: task.priority,
      task_effort: task.effort,
    },
  };
}
