import { z } from 'zod';

export const onboardingGenerateSchema = z
  .object({
    workspace_id: z.string().uuid(),
    agent_id: z.string().max(100).optional(),
    useCase: z.string().max(100).optional(),
  })
  .strip();

export const onboardingChatSchema = z
  .object({
    workspace_id: z.string().uuid(),
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(10000),
      }),
    ),
    personality_values: z.record(z.string(), z.number().min(0).max(100)).optional(),
  })
  .strip();

export const onboardingProfileSchema = z
  .object({
    workspace_id: z.string().uuid(),
  })
  .strip();

export const onboardingConfirmProfileSchema = z
  .object({
    workspace_id: z.string().uuid(),
    profile: z.object({
      summary: z.string().max(2000),
      role: z.string().max(200),
      goals: z.array(z.string().max(500)),
      working_style: z.string().max(1000),
      challenges: z.array(z.string().max(500)),
      agent_team: z.array(
        z.object({
          name: z.string().max(100),
          role: z.string().max(200),
          reason: z.string().max(500),
        }),
      ),
      suggested_project: z.object({
        name: z.string().max(200),
        description: z.string().max(2000),
        tasks: z.array(z.string().max(200)),
      }),
    }),
  })
  .strip();

export const taskGenerateSchema = z
  .object({
    prompt: z.string().min(1).max(5000),
    project_id: z.string().uuid().optional(),
    workspace_id: z.string().uuid().optional(),
  })
  .strip();

export const agentSeedSchema = z
  .object({
    workspace_id: z.string().uuid(),
    useCase: z.string().max(100).optional(),
  })
  .strip();

export const accessCodeCreateSchema = z
  .object({
    note: z.string().max(100).optional().nullable(),
  })
  .strip();

export const usageRollupSchema = z
  .object({
    period_type: z.enum(['daily', 'monthly']).optional(),
    lookback_days: z.number().int().min(1).max(90).optional(),
  })
  .strip();
