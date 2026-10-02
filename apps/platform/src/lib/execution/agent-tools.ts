/**
 * Built-in Tool Set for Agent Workers
 *
 * Core tools available to all agent workers during execution.
 * Each tool executes server-side and validates permissions.
 */

import { createServiceClient } from '@repo/db/service';
import type Anthropic from '@anthropic-ai/sdk';

// Tool definitions for Claude Messages API
export const AGENT_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'read_task',
    description: 'Read the full details of a task by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The UUID of the task to read' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_task',
    description: 'Update a task status, outcome, or description. Use this to report progress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The UUID of the task to update' },
        status: {
          type: 'string',
          enum: ['in_progress', 'review', 'done'],
          description: 'New status for the task',
        },
        outcome: { type: 'string', description: 'Outcome/result summary when completing a task' },
        description: { type: 'string', description: 'Updated description' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a task. Use this to log progress, decisions, or blockers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The UUID of the task' },
        content: { type: 'string', description: 'The comment text (markdown supported)' },
      },
      required: ['task_id', 'content'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks in the current project or workspace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string', description: 'Filter by project ID' },
        status: { type: 'string', description: 'Filter by status' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'read_memory',
    description: 'Search workspace memory for relevant context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query for memory entries' },
        category: {
          type: 'string',
          description: 'Filter by category (decision, preference, context, fact)',
        },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_memory',
    description: 'Store a new memory entry in workspace memory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title for the memory' },
        content: { type: 'string', description: 'Full content of the memory entry' },
        category: {
          type: 'string',
          enum: ['decision', 'preference', 'context', 'fact', 'general'],
          description: 'Memory category',
        },
      },
      required: ['title', 'content', 'category'],
    },
  },
  {
    name: 'report_blocker',
    description: 'Report that you are blocked and need human input. Stops execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Why you are blocked' },
        task_id: { type: 'string', description: 'The task that is blocked' },
      },
      required: ['reason', 'task_id'],
    },
  },
];

interface ToolContext {
  workspaceId: string;
  agentId: string;
  executionId: string;
}

/**
 * Execute a tool call from the agent worker.
 * Returns the result as a string for the tool_result content block.
 */
export async function executeAgentTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: string; shouldStop?: boolean }> {
  const supabase = createServiceClient();

  switch (toolName) {
    case 'read_task': {
      const { data, error } = await supabase
        .from('tasks')
        .select(
          'id, title, description, outcome, status, priority, assignee, metadata, effort, depends_on',
        )
        .eq('id', toolInput.task_id as string)
        .eq('workspace_id', ctx.workspaceId)
        .single();
      if (error) return { result: `Error: ${error.message}` };
      return { result: JSON.stringify(data, null, 2) };
    }

    case 'update_task': {
      const updates: Record<string, unknown> = {};
      if (toolInput.status) updates.status = toolInput.status;
      if (toolInput.outcome) updates.outcome = toolInput.outcome;
      if (toolInput.description) updates.description = toolInput.description;

      // If completing, stamp metadata
      if (toolInput.status === 'done') {
        const { data: existing } = await supabase
          .from('tasks')
          .select('metadata')
          .eq('id', toolInput.task_id as string)
          .single();
        const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
        updates.metadata = {
          ...meta,
          active_session: false,
          completed_by: ctx.agentId,
          work_completed_at: new Date().toISOString(),
        };
        updates.completed_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', toolInput.task_id as string)
        .eq('workspace_id', ctx.workspaceId)
        .select('id, title, status')
        .single();
      if (error) return { result: `Error: ${error.message}` };
      return { result: `Task updated: ${JSON.stringify(data)}` };
    }

    case 'add_comment': {
      const { error } = await supabase.from('task_comments').insert({
        task_id: toolInput.task_id as string,
        author: ctx.agentId,
        content: toolInput.content as string,
        workspace_id: ctx.workspaceId,
      });
      if (error) return { result: `Error: ${error.message}` };
      return { result: 'Comment added successfully.' };
    }

    case 'list_tasks': {
      let query = supabase
        .from('tasks')
        .select('id, title, status, priority, assignee, effort')
        .eq('workspace_id', ctx.workspaceId)
        .order('created_at', { ascending: false })
        .limit((toolInput.limit as number) ?? 20);

      if (toolInput.project_id) query = query.eq('project_id', toolInput.project_id as string);
      if (toolInput.status) query = query.eq('status', toolInput.status as string);

      const { data, error } = await query;
      if (error) return { result: `Error: ${error.message}` };
      return { result: JSON.stringify(data, null, 2) };
    }

    case 'read_memory': {
      const searchQuery = String(toolInput.query ?? '')
        .slice(0, 200)
        .replace(/['";\\\n]/g, ' ')
        .trim();
      if (!searchQuery) return { result: 'Search query is required.' };

      let query = supabase
        .from('agent_memory')
        .select('title, content, category, updated_at')
        .eq('workspace_id', ctx.workspaceId)
        .textSearch('content', searchQuery)
        .limit(Math.min((toolInput.limit as number) ?? 5, 20));

      if (toolInput.category) query = query.eq('category', toolInput.category as string);

      const { data, error } = await query;
      if (error) return { result: `Error: ${error.message}` };
      if (!data || data.length === 0) return { result: 'No matching memories found.' };
      return { result: JSON.stringify(data, null, 2) };
    }

    case 'write_memory': {
      const { error } = await supabase.from('agent_memory').insert({
        workspace_id: ctx.workspaceId,
        title: toolInput.title as string,
        content: toolInput.content as string,
        category: toolInput.category as string,
        source: `agent:${ctx.agentId}`,
      });
      if (error) return { result: `Error: ${error.message}` };
      return { result: 'Memory entry stored.' };
    }

    case 'report_blocker': {
      // Update the task as blocked
      const { data: existing } = await supabase
        .from('tasks')
        .select('metadata')
        .eq('id', toolInput.task_id as string)
        .single();
      const meta = (existing?.metadata ?? {}) as Record<string, unknown>;

      await supabase
        .from('tasks')
        .update({
          metadata: {
            ...meta,
            blocked: true,
            blocked_at: new Date().toISOString(),
            blocked_by: ctx.agentId,
            blocked_reason: toolInput.reason as string,
          },
        })
        .eq('id', toolInput.task_id as string);

      // Add a comment about the blocker
      await supabase.from('task_comments').insert({
        task_id: toolInput.task_id as string,
        author: ctx.agentId,
        content: `**Blocker reported:** ${toolInput.reason as string}`,
        workspace_id: ctx.workspaceId,
      });

      return { result: 'Blocker reported. Execution will stop.', shouldStop: true };
    }

    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}
