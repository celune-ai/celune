import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { safeErrorResponse } from '@/lib/api-error';
import { createActivity } from '@repo/db/queries';
import { validateOrigin } from '@/lib/csrf';
import { getAuthUserId } from '@/lib/auth';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

/** DELETE — remove an attachment */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const rateLimitResult = await applyRateLimit(
    request,
    'tasks.id.attachments.attachmentId.delete',
    RATE_WRITE,
  );
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, attachmentId } = await params;
    if (!isValidUuid(id) || !isValidUuid(attachmentId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }
    const supabase = await createClient();

    // Fetch attachment to get storage path
    const { data: attachment, error: fetchErr } = await supabase
      .from('task_attachments')
      .select('id, storage_path, file_name')
      .eq('id', attachmentId)
      .eq('task_id', id)
      .single();

    if (fetchErr || !attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Delete from storage
    const { error: storageErr } = await supabase.storage
      .from('task-attachments')
      .remove([attachment.storage_path]);

    if (storageErr) {
      console.error('Storage delete failed:', storageErr.message);
      // Continue to delete DB record even if storage fails
    }

    // Delete DB record
    const { error: deleteErr } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId);

    if (deleteErr) throw deleteErr;

    const workspaceId = request.nextUrl.searchParams.get('workspace_id');
    await createActivity(supabase, {
      event_type: 'attachment.deleted',
      severity: 'info',
      source: 'web',
      title: `Attachment deleted: ${attachment.file_name}`,
      task_id: id,
      details: {
        attachment_id: attachmentId,
        file_name: attachment.file_name,
        storage_path: attachment.storage_path,
      },
      workspace_id: workspaceId,
    }).catch(() => {}); // Non-blocking

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
