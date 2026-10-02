import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { reorderProjectGroups } from '@repo/db/queries';
import { reorderProjectGroupSchema } from '@/lib/schemas/projects.schema';
import { withApiSecurity, type SecurityContext } from '@/lib/api-security';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

type ReorderBody = z.infer<typeof reorderProjectGroupSchema>;

export const PUT = withApiSecurity<ReorderBody>(
  async (request: NextRequest, { body }: SecurityContext<ReorderBody>) => {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id required' }, { status: 400 });
    }
    const supabase = await createClient();
    const enriched = body.map((entry) => ({ ...entry, workspace_id: workspaceId }));
    await reorderProjectGroups(supabase, enriched);
    return NextResponse.json({ ok: true });
  },
  { parseBody: reorderProjectGroupSchema, permission: 'projects:update' },
);
