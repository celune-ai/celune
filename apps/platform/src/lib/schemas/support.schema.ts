import { z } from 'zod';

export const SUPPORT_CATEGORIES = ['bug', 'feature', 'billing', 'general'] as const;
export const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const SUPPORT_PRIORITIES = ['low', 'normal', 'urgent'] as const;

export const createSupportTicketSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(200).trim(),
    email: z.string().email('Valid email is required').max(500).trim(),
    subject: z.string().min(1, 'Subject is required').max(500).trim(),
    message: z.string().min(10, 'Please provide more detail (min 10 chars)').max(10_000).trim(),
    category: z.enum(SUPPORT_CATEGORIES).default('general'),
    priority: z.enum(SUPPORT_PRIORITIES).optional().default('normal'),
    user_id: z.string().uuid().nullable().optional(),
    org_id: z.string().uuid().nullable().optional(),
    workspace_id: z.string().uuid().nullable().optional(),
  })
  .strip();

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
