import { z } from 'zod';

export const createFeedbackSchema = z
  .object({
    name: z.string().max(255).optional().nullable(),
    email: z.string().email().max(255),
    subject: z.string().min(1).max(500),
    message: z.string().min(1).max(10_000),
    type: z.enum(['general', 'feature_request', 'improvement', 'praise', 'complaint']).optional(),
    rating: z.number().int().min(1).max(5).optional().nullable(),
    // New popover fields
    category: z.enum(['bug_report', 'feature_request', 'general']).optional(),
    priority: z.enum(['low', 'normal', 'urgent']).optional(),
    screenshot_url: z.string().url().max(2000).optional().nullable(),
    page_url: z.string().max(2000).optional().nullable(),
    user_agent: z.string().max(1000).optional().nullable(),
  })
  .strip();

export const updateFeedbackSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['new', 'reviewed', 'actioned', 'archived']).optional(),
    internal_notes: z.string().max(10_000).optional(),
    claimed_by: z.string().uuid().optional().nullable(),
  })
  .strip();

export const updateTicketStatusSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
  })
  .strip();
