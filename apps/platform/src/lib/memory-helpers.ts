const ABSTRACT_MAX_LENGTH = 500;

/** Generate a short abstract from content. No LLM — truncates at word boundary. */
export function generateAbstract(content: string): string {
  if (content.length <= ABSTRACT_MAX_LENGTH) return content;
  const truncated = content.slice(0, ABSTRACT_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > ABSTRACT_MAX_LENGTH * 0.6 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

/** Minimal Supabase client interface used by fire-and-forget helpers. */
interface SupabaseMinimal {
  from(table: string): {
    update(data: Record<string, unknown>): {
      eq(column: string, value: string): unknown;
    };
  };
}

/**
 * Fire-and-forget embedding generation via Supabase edge function.
 * Tracks embedding_status on the target row: 'pending' → 'complete' or 'failed'.
 *
 * @param table - Target table name (default: 'agent_memory')
 */
export function fireAndForgetEmbedding(
  supabase: SupabaseMinimal,
  rowId: string,
  content: string,
  table: string = 'agent_memory',
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  // Mark as pending before starting
  void supabase.from(table).update({ embedding_status: 'pending' }).eq('id', rowId);

  void fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ input: content }),
  })
    .then(async (res) => {
      if (res.ok) {
        const { embeddings } = await res.json();
        await supabase
          .from(table)
          .update({
            embedding: JSON.stringify(embeddings),
            embedding_status: 'complete',
            embedding_model: 'gte-small',
            embedding_dimension: 384,
          })
          .eq('id', rowId);
      } else {
        console.warn(`[memory-helpers] Embedding failed for ${table}:${rowId}: HTTP ${res.status}`);
        await supabase.from(table).update({ embedding_status: 'failed' }).eq('id', rowId);
      }
    })
    .catch((err) => {
      console.warn(`[memory-helpers] Embedding error for ${table}:${rowId}:`, err);
      void supabase.from(table).update({ embedding_status: 'failed' }).eq('id', rowId);
    });
}
