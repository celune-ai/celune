import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { parseBody } from '@/lib/parse-body';
import { verifyPortfolioPasswordSchema } from '@/lib/schemas/portfolio.schema';
import { verifyPasswordHash } from '@/lib/password-hash';
import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
import { URL_APP, URL_MARKETING } from '@/lib/branding';

export const dynamic = 'force-dynamic';

/** Allowed CORS origins for portfolio verification (embedded portfolios). */
const ALLOWED_ORIGINS = new Set([URL_APP, URL_MARKETING]);

function corsHeaders(request: NextRequest): HeadersInit {
  const origin = request.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : URL_APP;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/** OPTIONS — CORS preflight */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

/** POST /api/portfolio/verify — verify a portfolio password (public, CORS-enabled) */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);
  const rateLimitResult = await applyRateLimit(request, 'portfolio.verify.post', RATE_AUTH, false);
  if (rateLimitResult) return rateLimitResult.blocked;

  const parsed = await parseBody(request, verifyPortfolioPasswordSchema);
  if (parsed instanceof NextResponse) return parsed;

  const { project_id, password, workspace_id } = parsed;

  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from('portfolio_passwords')
    .select('password_hash')
    .eq('workspace_id', workspace_id)
    .eq('project_id', project_id);

  if (error) {
    return NextResponse.json({ verified: false }, { status: 500, headers });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ verified: false }, { status: 200, headers });
  }

  // Check all stored hashes for this project (typically just one)
  for (const row of rows) {
    if (row.password_hash) {
      const valid = await verifyPasswordHash(password, row.password_hash);
      if (valid) {
        return NextResponse.json({ verified: true }, { status: 200, headers });
      }
    }
  }

  return NextResponse.json({ verified: false }, { status: 200, headers });
}
