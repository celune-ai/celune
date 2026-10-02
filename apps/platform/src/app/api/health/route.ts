import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Lightweight, unauthenticated health check for Railway / load-balancer probes.
 * Returns 200 with basic status info. No auth required — this must be callable
 * by infrastructure health checkers without credentials.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    app: 'platform',
    timestamp: new Date().toISOString(),
  });
}
