import { z } from 'zod';
import { TASK_ASSIGNEES } from '@repo/types';

export const createCommentSchema = z
  .object({
    author: z.enum(TASK_ASSIGNEES),
    content: z.string().min(1).max(100_000),
  })
  .strip();
