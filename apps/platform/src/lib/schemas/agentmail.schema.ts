import { z } from 'zod';

export const agentmailSendSchema = z
  .object({
    agent_id: z.string().min(1).max(100),
    to: z.union([z.string().email(), z.array(z.string().email()).max(20)]),
    subject: z.string().min(1).max(500),
    body: z.string().max(50_000).optional(),
    html: z.string().max(100_000).optional(),
  })
  .strip();

export const agentmailReportSchema = z
  .object({
    from_agent: z.string().min(1).max(100),
    to: z.union([z.string().email(), z.array(z.string().email()).max(20)]),
    subject: z.string().min(1).max(500),
    markdown: z.string().min(1).max(50_000),
  })
  .strip();

export const agentmailProvisionSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strip();
