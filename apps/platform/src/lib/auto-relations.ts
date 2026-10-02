import { createServiceClient } from '@repo/db/service';
import type { MemoryRelationType } from '@/lib/schemas/memory.schema';

const MAX_AUTO_RELATIONS = 10;
const SIMILARITY_THRESHOLD = 0.85;

interface AutoRelationContext {
  memoryId: string;
  key: string;
  content: string;
  category: string;
  workspaceId: string;
  userId: string;
}

interface SupabaseClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          neq(
            column: string,
            value: string,
          ): {
            eq(
              column: string,
              value: boolean,
            ): {
              maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
              limit(n: number): Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
            };
            limit(n: number): Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
          };
        };
        neq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: boolean,
          ): {
            limit(n: number): Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
          };
        };
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
      };
    };
    upsert(
      data: Record<string, unknown>[],
      options: { onConflict: string },
    ): Promise<{ error: unknown }>;
  };
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
}

/**
 * Fire-and-forget auto-relation detection after memory creation.
 * Detects: same-key supersession, embedding similarity, category-based contradiction candidates.
 * Rate-limited to MAX_AUTO_RELATIONS per memory.
 */
export function detectAndCreateRelations(supabase: SupabaseClient, ctx: AutoRelationContext): void {
  void runDetection(supabase, ctx).catch((err) => {
    console.error(
      `[auto-relations] Detection failed for memory=${ctx.memoryId} workspace=${ctx.workspaceId} key=${ctx.key}:`,
      err instanceof Error ? err.message : err,
    );
  });
}

async function runDetection(supabase: SupabaseClient, ctx: AutoRelationContext): Promise<void> {
  const relations: Array<{
    memory_id: string;
    related_type: 'memory';
    related_id: string;
    relation_type: MemoryRelationType;
    confidence: number;
    is_auto_detected: boolean;
    detected_by: string;
    workspace_id: string;
  }> = [];

  // 1. Same-key supersession: if another non-archived memory has the same key, this supersedes it
  const { data: sameKeyMemory } = await supabase
    .from('agent_memory')
    .select('id, key')
    .eq('workspace_id', ctx.workspaceId)
    .eq('key', ctx.key)
    .neq('id', ctx.memoryId)
    .eq('is_archived', false)
    .maybeSingle();

  if (sameKeyMemory) {
    relations.push({
      memory_id: ctx.memoryId,
      related_type: 'memory',
      related_id: sameKeyMemory.id as string,
      relation_type: 'supersedes',
      confidence: 1.0,
      is_auto_detected: true,
      detected_by: 'key_match',
      workspace_id: ctx.workspaceId,
    });
  }

  // 2. Embedding similarity: find similar memories via match_memories RPC
  // Wait briefly for embedding to be generated (it's fire-and-forget)
  await new Promise((r) => setTimeout(r, 2000));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    try {
      const embResponse = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ input: ctx.content }),
      });

      if (embResponse.ok) {
        const { embeddings } = await embResponse.json();
        // Service client: match_memories is not executable by user roles; the caller inserted this memory under RLS. Accesses: agent_memory via match_memories.
        const { data: similar } = await createServiceClient().rpc('match_memories', {
          query_embedding: JSON.stringify(embeddings),
          match_threshold: SIMILARITY_THRESHOLD,
          match_count: MAX_AUTO_RELATIONS,
          filter_workspace_id: ctx.workspaceId,
        });

        if (similar) {
          for (const mem of similar) {
            const memId = mem.id as string;
            // Skip self and already-related
            if (memId === ctx.memoryId) continue;
            if (relations.some((r) => r.related_id === memId)) continue;
            if (relations.length >= MAX_AUTO_RELATIONS) break;

            relations.push({
              memory_id: ctx.memoryId,
              related_type: 'memory',
              related_id: memId,
              relation_type: 'elaborates',
              confidence: (mem.similarity as number) ?? 0.85,
              is_auto_detected: true,
              detected_by: 'embedding_similarity',
              workspace_id: ctx.workspaceId,
            });
          }
        }
      }
    } catch {
      // Embedding search failed — skip, non-fatal
    }
  }

  // 3. Decision contradiction candidates: same category=decision with different keys
  if (ctx.category === 'decision' && relations.length < MAX_AUTO_RELATIONS) {
    const { data: decisionMemories } = await supabase
      .from('agent_memory')
      .select('id, key, content')
      .eq('workspace_id', ctx.workspaceId)
      .eq('category', 'decision')
      .neq('id', ctx.memoryId)
      .eq('is_archived', false)
      .limit(5);

    if (decisionMemories) {
      for (const mem of decisionMemories) {
        if (relations.length >= MAX_AUTO_RELATIONS) break;
        if (relations.some((r) => r.related_id === (mem.id as string))) continue;

        relations.push({
          memory_id: ctx.memoryId,
          related_type: 'memory',
          related_id: mem.id as string,
          relation_type: 'contradicts',
          confidence: 0.5,
          is_auto_detected: true,
          detected_by: 'decision_category_match',
          workspace_id: ctx.workspaceId,
        });
      }
    }
  }

  // Batch upsert all detected relations
  if (relations.length > 0) {
    const { error } = await supabase.from('memory_relations').upsert(relations, {
      onConflict: 'memory_id,related_type,related_id,relation_type',
    });
    if (error) {
      console.warn('[auto-relations] Upsert failed:', error);
    }
  }
}
