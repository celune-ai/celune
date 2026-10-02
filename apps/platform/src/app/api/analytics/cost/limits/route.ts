import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { cachedJson } from '@/lib/api-cache';
import { requireWorkspaceScope } from '@/lib/require-workspace';

export const dynamic = 'force-dynamic';

// ─── Static limit definitions ────────────────────────────────────────────────
// Update these ceilings when plan limits change.

interface LimitDef {
  id: string;
  name: string;
  category: 'api' | 'database' | 'infra';
  unit: string;
  /** Hard limit from the plan. null = unlimited/unknown */
  limit: number | null;
  /** Warning threshold (0–1, fraction of limit). Default 0.8 */
  warnAt?: number;
}

const LIMIT_DEFS: LimitDef[] = [
  // ── Supabase Pro ──
  {
    id: 'supabase-db-size',
    name: 'Supabase DB Size',
    category: 'database',
    unit: 'MB',
    limit: 8 * 1024, // 8 GB on Pro
    warnAt: 0.75,
  },
  {
    id: 'supabase-storage',
    name: 'Supabase Storage',
    category: 'database',
    unit: 'GB',
    limit: 100,
    warnAt: 0.8,
  },
  {
    id: 'supabase-egress',
    name: 'Supabase Egress',
    category: 'database',
    unit: 'GB',
    limit: 250,
    warnAt: 0.8,
  },
  // ── Vercel Pro ──
  {
    id: 'vercel-bandwidth',
    name: 'Vercel Bandwidth',
    category: 'infra',
    unit: 'GB',
    limit: 1024, // 1TB on Pro
    warnAt: 0.7,
  },
  {
    id: 'vercel-builds',
    name: 'Vercel Builds',
    category: 'infra',
    unit: 'builds/mo',
    limit: 6000,
    warnAt: 0.8,
  },
  // ── Claude API (budget-based) ──
  {
    id: 'claude-monthly-usage',
    name: 'Claude Usage Value (est.)',
    category: 'api',
    unit: 'USD',
    limit: null, // No hard limit — Max 20x covers all usage
    warnAt: 0.8,
  },
];

export interface LimitResult extends LimitDef {
  used: number | null;
  pct: number | null;
  status: 'ok' | 'warn' | 'over' | 'unknown';
}

export async function GET(request: NextRequest) {
  // Workspace scope is required
  const wsScope = await requireWorkspaceScope(request);
  if (wsScope instanceof NextResponse) return wsScope;

  const supabase = await createClient();
  const workspace_id = wsScope.workspace_id;
  const workspace_ids = wsScope.workspace_ids;

  // ── Fetch live usage values ──────────────────────────────────────────────

  // Claude API: current calendar month spend
  let claudeMonthlySpend: number | null = null;
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let usageQuery = supabase
      .from('claude_usage')
      .select('total_cost_usd')
      .gte('created_at', monthStart.toISOString());
    if (workspace_ids && workspace_ids.length > 0) {
      usageQuery = usageQuery.in('workspace_id', workspace_ids);
    } else if (workspace_id) {
      usageQuery = usageQuery.eq('workspace_id', workspace_id);
    }

    const { data: usageRows, error } = await usageQuery;

    if (!error && usageRows) {
      claudeMonthlySpend = usageRows.reduce((s, r) => s + (Number(r.total_cost_usd) || 0), 0);
    }
  } catch {
    // non-fatal
  }

  // Supabase DB size: query pg_database_size via RPC if available
  let dbSizeMb: number | null = null;
  try {
    const { data, error } = await supabase.rpc('get_db_size_mb');
    if (!error && typeof data === 'number') {
      dbSizeMb = data;
    }
  } catch {
    // RPC not available — leave as null
  }

  // ── Build results ────────────────────────────────────────────────────────

  const usageMap: Record<string, number | null> = {
    'claude-monthly-usage': claudeMonthlySpend,
    'supabase-db-size': dbSizeMb,
    // Storage, egress, and Vercel metrics require external API calls;
    // leave null until integrated with Vercel API or Supabase API.
    'supabase-storage': null,
    'supabase-egress': null,
    'vercel-bandwidth': null,
    'vercel-builds': null,
  };

  const results: LimitResult[] = LIMIT_DEFS.map((def) => {
    const used = usageMap[def.id] ?? null;
    const warnAt = def.warnAt ?? 0.8;

    let pct: number | null = null;
    let status: LimitResult['status'] = 'unknown';

    if (used !== null && def.limit !== null) {
      pct = Math.round((used / def.limit) * 100 * 10) / 10;
      if (used > def.limit) status = 'over';
      else if (used / def.limit >= warnAt) status = 'warn';
      else status = 'ok';
    } else if (used !== null) {
      // No limit defined — just show usage
      status = 'ok';
    }

    return { ...def, used, pct, status };
  });

  return cachedJson({ limits: results });
}
