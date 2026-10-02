import { z } from 'zod';

export const waitlistSignupSchema = z
  .object({
    email: z.string().email().max(255),
    source: z.string().max(50).optional(),
    ref: z.string().max(255).optional(),
    utm_source: z.string().max(255).optional(),
    utm_medium: z.string().max(255).optional(),
    utm_campaign: z.string().max(255).optional(),
    utm_content: z.string().max(255).optional(),
    referrer: z.string().max(500).optional(),
  })
  .strip();

export const waitlistUpdateSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'confirmed', 'invited', 'converted']),
    notes: z.string().max(2000).optional(),
  })
  .strip();
