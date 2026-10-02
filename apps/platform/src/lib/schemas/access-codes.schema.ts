import { z } from 'zod';

export const redeemAccessCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(8, 'Code must be at least 8 characters')
    .max(20, 'Code must be at most 20 characters')
    .regex(/^[A-Z0-9]+$/, 'Code must be alphanumeric'),
});

/** Schema for the public /api/access-codes/validate endpoint. */
export const validateAccessCodeSchema = z
  .object({
    code: z.string().min(1, 'Code is required').max(50),
  })
  .strip();
