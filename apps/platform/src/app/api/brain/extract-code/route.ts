/**
 * POST /api/brain/extract-code
 *
 * Extract code examples from skill content and store in brain_code_examples.
 * Called during skill creation/bootstrap or manual re-extraction.
 *
 * Body: { workspace_id, manifest_id?, content, source_path? }
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { isValidUuid } from '@repo/db/validation';
import { getAuthUserId } from '@/lib/auth';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import { validateOrigin } from '@/lib/csrf';
import { applyRateLimit, RATE_WRITE } from '@/lib/rate-limiter';
import { extractCodeBlocks, summarizeCodeBlock } from '@repo/db/brain-manifest-registry';
import { fireAndForgetEmbedding } from '@/lib/memory-helpers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const extractSchema = z.object({
  workspace_id: z.string().uuid(),
  manifest_id: z.string().uuid().optional(),
  content: z.string().min(1).max(500_000),
  source_path: z.string().max(500).optional(),
});

export async function POST(request: NextRequest) {
  const originError = await validateOrigin(request);
  if (originError) return originError;
  const rateLimitResult = await applyRateLimit(request, 'brain.extract-code', RATE_WRITE);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const userId = getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = extractSchema.safeParse(rawBody);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join('; ');
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const { workspace_id, manifest_id, content, source_path } = parsed.data;

    if (manifest_id && !isValidUuid(manifest_id)) {
      return NextResponse.json({ error: 'Invalid manifest_id' }, { status: 400 });
    }

    const forbidden = await requireWorkspaceMembership(userId, workspace_id);
    if (forbidden) return forbidden;

    // Extract code blocks from content
    const blocks = extractCodeBlocks(content);
    if (blocks.length === 0) {
      return NextResponse.json({ data: { extracted: 0, examples: [] } });
    }

    // Service client: inserts code examples. Accesses: brain_code_examples.
    const supabase = createServiceClient();

    const rows = blocks.map((block) => ({
      workspace_id,
      manifest_id: manifest_id ?? null,
      code_block: block.code,
      language: block.language,
      summary: summarizeCodeBlock(block.code, block.language),
      source_path: source_path ?? null,
    }));

    // Delete existing examples for this manifest to avoid duplicates (expression-based
    // unique index doesn't work with PostgREST upsert). This is safe because we're
    // re-extracting all blocks from the full content.
    if (manifest_id) {
      await supabase
        .from('brain_code_examples')
        .delete()
        .eq('workspace_id', workspace_id)
        .eq('manifest_id', manifest_id);
    }

    const { data, error } = await supabase
      .from('brain_code_examples')
      .insert(rows)
      .select('id, language, summary, source_path');

    if (error) {
      console.error('[brain/extract-code] Insert error:', error);
      return NextResponse.json({ error: 'Failed to store code examples' }, { status: 500 });
    }

    // Fire-and-forget embedding generation for each code example
    for (const example of data ?? []) {
      const block = blocks.find((b) => summarizeCodeBlock(b.code, b.language) === example.summary);
      if (block) {
        fireAndForgetEmbedding(
          supabase,
          example.id,
          `${example.summary}\n\n${block.code}`,
          'brain_code_examples',
        );
      }
    }

    return NextResponse.json({
      data: {
        extracted: data?.length ?? 0,
        examples: data ?? [],
      },
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
