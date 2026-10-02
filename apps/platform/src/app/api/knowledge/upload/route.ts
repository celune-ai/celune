import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { safeErrorResponse } from '@/lib/api-error';
import { extractRequiredWorkspaceId, requireWorkspaceMembership } from '@/lib/require-workspace';
import { getAuthUserId } from '@/lib/auth';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'text/markdown',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.md', '.txt', '.docx']);

/** Generate embedding via Supabase edge function. Returns null on failure. */
async function generateEmbedding(input: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) return null;
    const { embeddings } = await res.json();
    return JSON.stringify(embeddings);
  } catch {
    return null;
  }
}

/**
 * POST /api/knowledge/upload?workspace_id=...
 * Upload files (PDF, MD, TXT, DOCX) to the knowledge base.
 * Multipart form data with 'file' field(s).
 * Max file size: 50MB.
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'knowledge.upload.post', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  const originError = await validateOrigin(request);
  if (originError) return originError;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const wsResult = extractRequiredWorkspaceId(request);
    if (wsResult instanceof NextResponse) return wsResult;
    const workspaceId = wsResult;

    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) return membershipError;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Sanitize filename — strip path separators to prevent traversal
    const safeName = file.name.replace(/[/\\]/g, '_').replace(/\.\./g, '_');

    // Validate file type
    const ext = '.' + safeName.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();

    // Get or create the "upload" source for this workspace
    let { data: uploadSource } = await supabase
      .from('knowledge_sources')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'upload')
      .single();

    if (!uploadSource) {
      const { data: newSource, error: createError } = await supabase
        .from('knowledge_sources')
        .insert({
          workspace_id: workspaceId,
          provider: 'upload',
          display_name: 'File Uploads',
          status: 'active',
          config: {},
          sync_frequency_hours: 0, // Manual only
          items_count: 0,
          storage_bytes: 0,
          created_by: userId,
        })
        .select('id')
        .single();

      if (createError) throw createError;
      uploadSource = newSource;
    }

    // Read file content
    const fileBuffer = await file.arrayBuffer();
    const fileContent = new TextDecoder().decode(fileBuffer);

    // For now, chunk by splitting on double newlines (simple chunking).
    // A more sophisticated pipeline would use recursive text splitters.
    const chunks = fileContent
      .split(/\n\n+/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 50); // Skip very short chunks

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'File contains no indexable content' }, { status: 400 });
    }

    // Index each chunk as a knowledge item
    let itemsIndexed = 0;
    let totalBytes = 0;

    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk);

      const { error: insertError } = await supabase.from('knowledge_items').insert({
        source_id: uploadSource.id,
        workspace_id: workspaceId,
        title: safeName,
        content: chunk,
        content_hash: await hashContent(chunk),
        embedding: embedding,
        metadata: {
          filename: safeName,
          file_type: ext,
          chunk_index: itemsIndexed,
        },
      });

      if (!insertError) {
        itemsIndexed++;
        totalBytes += new TextEncoder().encode(chunk).length;
      }
    }

    // Update source counters
    const { data: currentSource } = await supabase
      .from('knowledge_sources')
      .select('items_count, storage_bytes')
      .eq('id', uploadSource.id)
      .single();

    await supabase
      .from('knowledge_sources')
      .update({
        items_count: (currentSource?.items_count ?? 0) + itemsIndexed,
        storage_bytes: (currentSource?.storage_bytes ?? 0) + totalBytes,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', uploadSource.id);

    return NextResponse.json(
      {
        source_id: uploadSource.id,
        items_indexed: itemsIndexed,
        filename: safeName,
      },
      { status: 201 },
    );
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/** Simple content hash using Web Crypto API (available in Edge Runtime). */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
