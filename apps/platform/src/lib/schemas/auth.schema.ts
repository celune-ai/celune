import { z } from 'zod';

export const cliTokenSchema = z
  .object({
    access_token: z.string().min(1, 'access_token is required'),
  })
  .strip();
