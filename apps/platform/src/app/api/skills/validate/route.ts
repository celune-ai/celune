/**
 * BYO Skill Validation endpoint.
 *
 * POST /api/skills/validate  { content, path?, category? }
 *
 * Validates a user-submitted skill and returns quality gates result.
 * Does NOT create the skill — use POST /api/skills to actually add it.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import {
  validateBYOSkill,
  meetsQualityGate,
  MIN_QUALITY_SCORE,
} from '@repo/db/byo-skill-validator';
import { z } from 'zod';
import type { BrainCategory } from '@repo/types';

export const dynamic = 'force-dynamic';

const validateSchema = z.object({
  content: z.string().min(1).max(100_000),
  path: z.string().max(500).optional(),
  category: z
    .enum(['skill', 'hook', 'agent', 'agent_doc', 'memory', 'settings', 'delegation'])
    .optional(),
});

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'skills.validate', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = validateSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { content, path, category } = parsed.data;

    const validation = validateBYOSkill(content, {
      path,
      category: category as BrainCategory | undefined,
    });

    const passes = meetsQualityGate(validation);

    return NextResponse.json({
      data: {
        ...validation,
        passes_quality_gate: passes,
        min_quality_score: MIN_QUALITY_SCORE,
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
