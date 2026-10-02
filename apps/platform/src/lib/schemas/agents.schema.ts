import { z } from 'zod';

const messageParamSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.union([
      z.string(),
      z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
    ]),
  })
  .strip();

const parameterValuesSchema = z.record(z.string(), z.number());

export const chatMessageSchema = z
  .object({
    messages: z.array(messageParamSchema).min(1),
    parameters: parameterValuesSchema,
    voice_mode: z.boolean().optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strip();

export const agentConfigSchema = z
  .object({
    parameters: parameterValuesSchema.optional(),
    active_profile: z.string().optional(),
    display_name: z.string().min(1).max(100).optional(),
    role: z.string().max(100).optional(),
    description: z.string().max(2000).optional(),
    color: z
      .string()
      .regex(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Invalid hex color')
      .optional(),
    persona_prompt: z.string().min(1).max(5000).optional(),
    model: z.string().max(100).optional(),
    icon: z.string().max(500).optional(),
    budget_cap_usd: z.number().min(0).nullable().optional(),
  })
  .strip();
