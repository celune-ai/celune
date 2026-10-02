import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@repo/db/server';
import { isValidUuid } from '@repo/db/validation';
import { randomUUID } from 'crypto';
import { safeErrorResponse } from '@/lib/api-error';
import { createActivity } from '@repo/db/queries';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { requirePermission } from '@/lib/permissions';

import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES as ALLOWED_MIME_TYPES,
  MAX_ATTACHMENT_BYTES as MAX_FILE_SIZE,
  sanitizeAttachmentName as sanitizeFileName,
} from '@/lib/attachment-types';
export const dynamic = 'force-dynamic';

/** Fallback: infer MIME from extension when browser sends generic type */
const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.py': 'text/x-python',
  '.sql': 'application/sql',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'application/toml',
};

function resolveMimeType(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES.has(file.type)) return file.type;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return EXT_TO_MIME[ext] ?? file.type;
}

/** GET — list attachments for a task */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
    const permResult = await requirePermission(request, workspaceId, 'tasks:read');
    if (permResult instanceof NextResponse) return permResult;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('task_attachments')
      .select('id, task_id, file_name, file_size, mime_type, storage_path, uploaded_by, created_at')
      .eq('task_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Generate signed URLs
    const attachments = await Promise.all(
      (data ?? []).map(async (att) => {
        const { data: signedData } = await supabase.storage
          .from('task-attachments')
          .createSignedUrl(att.storage_path, 3600); // 1 hour
        return { ...att, download_url: signedData?.signedUrl ?? null };
      }),
    );

    return NextResponse.json(attachments);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/** POST — upload attachment(s) to a task */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await applyRateLimit(request, 'tasks.id.attachments.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;
    const workspaceId = request.nextUrl.searchParams.get('workspace_id') ?? null;
    const permResult = await requirePermission(request, workspaceId, 'tasks:update');
    if (permResult instanceof NextResponse) return permResult;

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid task ID' }, { status: 400 });
    }
    const supabase = await createClient();

    // Verify task exists
    const { data: task, error: taskErr } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', id)
      .single();
    if (taskErr || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const uploadedBy = (formData.get('uploaded_by') as string) || permResult.userId || 'system';

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const results = [];
    const errors = [];

    for (const file of files) {
      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        errors.push({
          file: file.name,
          error: `File exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        });
        continue;
      }

      // Validate MIME type
      const mimeType = resolveMimeType(file);
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        errors.push({ file: file.name, error: `File type not allowed: ${mimeType}` });
        continue;
      }

      // Upload to storage
      const safeName = sanitizeFileName(file.name);
      const storagePath = `${id}/${randomUUID()}_${safeName}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error: uploadErr } = await supabase.storage
        .from('task-attachments')
        .upload(storagePath, buffer, { contentType: mimeType });

      if (uploadErr) {
        errors.push({ file: file.name, error: uploadErr.message });
        continue;
      }

      // Insert DB record
      const { data: attachment, error: insertErr } = await supabase
        .from('task_attachments')
        .insert({
          task_id: id,
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          storage_path: storagePath,
          uploaded_by: uploadedBy,
        })
        .select()
        .single();

      if (insertErr) {
        // Clean up storage on DB failure
        await supabase.storage.from('task-attachments').remove([storagePath]);
        errors.push({ file: file.name, error: insertErr.message });
        continue;
      }

      // Generate signed URL
      const { data: signedData } = await supabase.storage
        .from('task-attachments')
        .createSignedUrl(storagePath, 3600);

      results.push({ ...attachment, download_url: signedData?.signedUrl ?? null });
    }

    // Log activity for successful uploads
    if (results.length > 0) {
      const fileNames = results.map((r) => r.file_name).join(', ');
      await createActivity(supabase, {
        event_type: 'attachment.uploaded',
        severity: 'info',
        source: 'web',
        title: `${results.length} file(s) uploaded: ${fileNames}`,
        task_id: id,
        details: {
          file_count: results.length,
          error_count: errors.length,
          files: results.map((r) => ({
            name: r.file_name,
            size: r.file_size,
            type: r.mime_type,
          })),
        },
        workspace_id: workspaceId,
      }).catch(() => {}); // Non-blocking — don't fail upload if logging fails
    }

    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json({ error: 'All uploads failed', details: errors }, { status: 400 });
    }

    return NextResponse.json(
      { attachments: results, errors },
      { status: results.length > 0 ? 201 : 400 },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}
