import { z } from 'zod';
import { TASK_STATUSES, TASK_PRIORITIES, TASK_ASSIGNEES } from '@repo/types';

export const createTaskSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable().optional(),
    outcome: z.string().max(50_000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assignee: z.enum(TASK_ASSIGNEES).optional(),
    project_id: z.string().uuid().nullable().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    spawned_by: z.string().max(500).nullable().optional(),
    category: z.array(z.string()).optional(),
    due_date: z.string().nullable().optional(),
    source: z.string().max(500).nullable().optional(),
    source_ref: z.string().max(1000).nullable().optional(),
    vault_path: z.string().max(1000).nullable().optional(),
    time_estimate_minutes: z.number().int().positive().nullable().optional(),
    time_spent_minutes: z.number().int().nonnegative().nullable().optional(),
    context_keys: z.array(z.string()).optional(),
    subtasks: z
      .array(z.object({ title: z.string(), done: z.boolean() }))
      .nullable()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    effort: z.enum(['S', 'M', 'L']).nullable().optional(),
    depends_on: z.array(z.string().uuid()).optional(),
    workspace_id: z.string().uuid(),
    sort_order: z.number().optional(),
  })
  .strip();

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(50_000).nullable().optional(),
    outcome: z.string().max(50_000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assignee: z.enum(TASK_ASSIGNEES).optional(),
    project_id: z.string().uuid().nullable().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    category: z.array(z.string()).optional(),
    due_date: z.string().nullable().optional(),
    depends_on: z.array(z.string().uuid()).optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    effort: z.enum(['S', 'M', 'L']).nullable().optional(),
    sort_order: z.number().optional(),
    completed_at: z.string().nullable().optional(),
  })
  .strip();

export const reorderTaskSchema = z.array(
  z
    .object({
      id: z.string().uuid(),
      status: z.enum(TASK_STATUSES),
      sort_order: z.number(),
    })
    .strip(),
);
