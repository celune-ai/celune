import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { getAuthUserId } from '@/lib/auth';
import { getTaskUsage } from '@/lib/tasks/task-usage';

export const dynamic = 'force-dynamic';

/**
 * Aggregate token usage from claude_usage for a specific task.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getAuthUserId(_req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const supabase = await createClient();
    return NextResponse.json(await getTaskUsage(supabase, id));
  } catch (error) {
    return safeErrorResponse(error);
  }
}
