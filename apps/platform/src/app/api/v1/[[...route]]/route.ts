import type { NextRequest } from 'next/server';
import { getPlatformApi } from '@/lib/api/host';
import { applyRateLimit, RATE_READ, RATE_WRITE } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

// The package app authenticates every request (API key or host JWT) in its middleware.
async function handler(request: NextRequest) {
  const tier = request.method === 'GET' ? RATE_READ : RATE_WRITE;
  // Keyed by IP: this surface carries bearer tokens only, and keys have their own per-key limit.
  const limited = await applyRateLimit(request, 'api.v1', tier, false);
  if (limited) return limited.blocked;
  return getPlatformApi().fetch(request);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
