import { z } from 'zod';

/** Create a portfolio password entry */
export const createPortfolioPasswordSchema = z.object({
  project_id: z.string().uuid(),
  password: z.string().min(1).max(200),
});

/** Update a portfolio password entry */
export const updatePortfolioPasswordSchema = z.object({
  password: z.string().min(1).max(200).optional(),
});

/** Verify a portfolio password */
export const verifyPortfolioPasswordSchema = z.object({
  project_id: z.string().uuid(),
  password: z.string().min(1).max(200),
  workspace_id: z.string().uuid(),
});
