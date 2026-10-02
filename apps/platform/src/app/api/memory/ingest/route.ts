/**
 * POST /api/memory/ingest
 *
 * Cron-compatible endpoint that triggers the memory ingestion pipeline.
 * Reads recent activity_log entries not yet processed, maps high-signal
 * events to memories, and creates them via the existing memory infrastructure.
 *
 * Auth: requires CRON_SECRET Bearer token (same as /api/cron/run).
 * Can also be called with a workspace_id query param to process a single workspace.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { timingSafeEqual } from 'crypto';
import { ingestAllWorkspaces, ingestWorkspaceMemories } from '@/lib/memory-ingestion';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Require CRON_SECRET — fail closed when missing
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${cronSecret}`;
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();

    // Optional: process a single workspace
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');

    if (workspaceId) {
      const result = await ingestWorkspaceMemories(supabase, workspaceId);
      return NextResponse.json({
        workspace_id: workspaceId,
        ...result,
      });
    }

    // Process all workspaces with unprocessed activities
    const { workspaces, total } = await ingestAllWorkspaces(supabase);
    return NextResponse.json({
      workspaces_processed: workspaces,
      ...total,
    });
  } catch (err) {
    console.error('[memory/ingest] error:', err);
    return NextResponse.json({ error: 'Memory ingestion failed' }, { status: 500 });
  }
}
