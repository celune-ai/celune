import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { safeErrorResponse } from '@/lib/api-error';
import { parseBody, isErrorResponse } from '@/lib/parse-body';
import { z } from 'zod';
import { dispatchNotification } from '@repo/notifications';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

const dispatchSchema = z.object({
  type: z.string().min(1),
  workspaceId: z.string().uuid(),
  actorAgent: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'];

function isInternalRequest(request: NextRequest): boolean {
  // INTERNAL_API_KEY must always be set — no dev bypass
  const auth = request.headers.get('authorization');
  if (!auth || !INTERNAL_API_KEY) return false;
  const expected = `Bearer ${INTERNAL_API_KEY}`;
  if (auth.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

/**
 * POST /api/notifications/dispatch
 *
 * Internal-only route to dispatch a notification event.
 * Protected by INTERNAL_API_KEY header check.
 *
 * Body: { type, workspaceId, actorAgent?, payload }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'notifications.dispatch.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    if (!isInternalRequest(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseBody(request, dispatchSchema);
    if (isErrorResponse(body)) return body;

    const results = await dispatchNotification({
      type: body.type,
      workspaceId: body.workspaceId,
      actorAgent: body.actorAgent,
      payload: body.payload,
    });

    return NextResponse.json({
      dispatched: results.length,
      results,
    });
  } catch (err) {
    return safeErrorResponse(err);
  }
}
