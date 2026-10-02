/**
 * Discord passive memory ingestion.
 *
 * Processes Discord messages for memory storage — filters noise, checks
 * relevance against active projects/tasks, and stores valuable context
 * in the agent_memory table.
 *
 * v2: Added Claude summarization, classification (decision/preference/context/fact),
 *     dedup against existing memories, and periodic batch summarization.
 */

import { createServiceClient } from '@repo/db/service';
import { redactPii } from './guardrails/pii-detector';
import type { GatewayMessage } from './discord-gateway';

// ── Types ──────────────────────────────────────────────────────────────────

export interface IngestResult {
  stored: boolean;
  reason: string;
  memoryId?: string;
  classification?: MemoryClassification;
}

export interface BatchIngestResult {
  processed: number;
  stored: number;
  skipped: number;
}

export type MemoryClassification = 'decision' | 'preference' | 'context' | 'fact';

interface SummarizedMemory {
  summary: string;
  classification: MemoryClassification;
  keyEntities: string[];
}

// ── Message Accumulator for Batch Processing ──────────────────────────────

interface AccumulatedMessage {
  message: GatewayMessage;
  workspaceId: string;
  timestamp: number;
}

const messageBuffer = new Map<string, AccumulatedMessage[]>();
const BATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_BATCH_SIZE = 3;
const MAX_BUFFER_SIZE = 50;

// ── Filters ────────────────────────────────────────────────────────────────

const MAX_BATCH_SIZE = 100;
const MIN_MESSAGE_LENGTH = 10;
const COMMAND_PREFIXES = ['/', '!', '$', '.', '?'];

function shouldSkipMessage(message: GatewayMessage): string | null {
  if (message.author.bot) return 'bot_message';
  if (message.content.length < MIN_MESSAGE_LENGTH) return 'too_short';
  if (COMMAND_PREFIXES.some((p) => message.content.startsWith(p))) return 'command';
  // Skip messages that are just URLs with no context
  if (/^https?:\/\/\S+$/.test(message.content.trim())) return 'bare_url';
  return null;
}

// ── Relevance Check ────────────────────────────────────────────────────────

async function getWorkspaceKeywords(
  workspaceId: string,
): Promise<{ projects: string[]; tasks: string[] }> {
  const supabase = createServiceClient();

  const [{ data: projects }, { data: tasks }] = await Promise.all([
    supabase
      .from('projects')
      .select('name')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .limit(50),
    supabase
      .from('tasks')
      .select('title')
      .eq('workspace_id', workspaceId)
      .in('status', ['in_progress', 'assigned', 'planning'])
      .limit(100),
  ]);

  return {
    projects: (projects ?? []).map((p) => p.name.toLowerCase()),
    tasks: (tasks ?? []).map((t) => t.title.toLowerCase()),
  };
}

function checkRelevance(
  content: string,
  keywords: { projects: string[]; tasks: string[] },
): { relevant: boolean; matchedKeywords: string[] } {
  const lower = content.toLowerCase();
  const matched: string[] = [];

  for (const name of keywords.projects) {
    // Match on words from the project name (skip very short words)
    const words = name.split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => lower.includes(w))) {
      matched.push(name);
    }
  }

  for (const title of keywords.tasks) {
    const words = title.split(/\s+/).filter((w) => w.length > 3);
    if (words.some((w) => lower.includes(w))) {
      matched.push(title);
    }
  }

  return { relevant: matched.length > 0, matchedKeywords: matched };
}

// ── Deduplication ──────────────────────────────────────────────────────────

async function isDuplicate(messageId: string, workspaceId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { count } = await supabase
    .from('agent_memory')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('category', 'discord_conversation')
    .like('content', `%[msg:${messageId}]%`);

  return (count ?? 0) > 0;
}

// ── Ingestion ──────────────────────────────────────────────────────────────

/**
 * Process a single Discord message for memory storage.
 *
 * Filters noise, checks relevance against workspace context, deduplicates,
 * and stores relevant messages in agent_memory.
 */
export async function ingestDiscordMessage(
  message: GatewayMessage,
  workspaceId: string,
): Promise<IngestResult> {
  // Step 1: Basic filters
  const skipReason = shouldSkipMessage(message);
  if (skipReason) {
    return { stored: false, reason: skipReason };
  }

  // Step 2: Deduplication
  if (await isDuplicate(message.id, workspaceId)) {
    return { stored: false, reason: 'duplicate' };
  }

  // Step 3: Relevance check
  const keywords = await getWorkspaceKeywords(workspaceId);
  const { relevant, matchedKeywords } = checkRelevance(message.content, keywords);

  if (!relevant) {
    return { stored: false, reason: 'not_relevant' };
  }

  // Step 4: Store in agent_memory (with PII redaction)
  const supabase = createServiceClient();
  const sanitizedContent = redactPii(message.content);

  const memoryContent = [
    `[msg:${message.id}] Discord message from @${message.author.username}`,
    `Channel: ${message.channel_id}${message.guild_id ? ` (Guild: ${message.guild_id})` : ''}`,
    `Matched context: ${matchedKeywords.join(', ')}`,
    '',
    sanitizedContent,
  ].join('\n');

  const { data, error } = await supabase
    .from('agent_memory')
    .insert({
      workspace_id: workspaceId,
      content: memoryContent,
      category: 'discord_conversation',
      metadata: {
        discord_message_id: message.id,
        discord_channel_id: message.channel_id,
        discord_guild_id: message.guild_id ?? null,
        discord_author_id: message.author.id,
        discord_author_username: message.author.username,
        matched_keywords: matchedKeywords,
        timestamp: message.timestamp,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[discord-memory-ingest] Failed to store memory:', error);
    return { stored: false, reason: 'db_error' };
  }

  return { stored: true, reason: 'relevant', memoryId: data.id };
}

/**
 * Batch-ingest multiple Discord messages.
 * Useful for backfilling or processing queued messages.
 */
export async function batchIngestMessages(
  messages: GatewayMessage[],
  workspaceId: string,
): Promise<BatchIngestResult> {
  if (messages.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${messages.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
  }

  let stored = 0;
  let skipped = 0;

  // Process sequentially to respect rate limits and dedup correctly
  for (const message of messages) {
    const result = await ingestDiscordMessage(message, workspaceId);
    if (result.stored) {
      stored++;
    } else {
      skipped++;
    }
  }

  return { processed: messages.length, stored, skipped };
}

// ── Claude Summarization ──────────────────────────────────────────────────

/**
 * Use Claude to summarize a Discord message and classify its type.
 * Returns null if summarization fails (falls back to raw storage).
 */
async function summarizeMessage(content: string): Promise<SummarizedMemory | null> {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            'Analyze this Discord message and extract the core information.',
            '',
            'Respond in JSON only:',
            '{',
            '  "summary": "1-2 sentence summary of the key information",',
            '  "classification": "decision|preference|context|fact",',
            '  "keyEntities": ["entity1", "entity2"]',
            '}',
            '',
            'Classifications:',
            '- decision: A choice or determination that was made',
            '- preference: A stated preference, opinion, or style choice',
            '- context: Background information about a situation or project',
            '- fact: A verifiable piece of information or technical detail',
            '',
            `Message: ${content}`,
          ].join('\n'),
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null;
    if (!text) return null;

    const parsed = JSON.parse(text) as SummarizedMemory;
    if (!parsed.summary || !parsed.classification) return null;

    return parsed;
  } catch (err) {
    console.error('[discord-memory-ingest] Summarization failed:', err);
    return null;
  }
}

/**
 * Check if a similar memory already exists (semantic dedup).
 * Uses text search to find memories with overlapping content.
 */
async function hasSimilarMemory(workspaceId: string, summary: string): Promise<boolean> {
  const supabase = createServiceClient();

  // Extract key terms for search (take first 5 significant words)
  const searchTerms = summary
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 5)
    .join(' & ');

  if (!searchTerms) return false;

  const { count } = await supabase
    .from('agent_memory')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('category', 'discord_conversation')
    .textSearch('content', searchTerms, { type: 'websearch' });

  return (count ?? 0) > 0;
}

/**
 * Ingest a message with Claude summarization.
 * Falls back to raw storage if summarization fails.
 */
export async function ingestWithSummarization(
  message: GatewayMessage,
  workspaceId: string,
): Promise<IngestResult> {
  // Basic filters first
  const skipReason = shouldSkipMessage(message);
  if (skipReason) {
    return { stored: false, reason: skipReason };
  }

  // Dedup by message ID
  if (await isDuplicate(message.id, workspaceId)) {
    return { stored: false, reason: 'duplicate' };
  }

  const sanitizedContent = redactPii(message.content);

  // Try Claude summarization
  const summarized = await summarizeMessage(sanitizedContent);

  if (summarized) {
    // Semantic dedup: check if similar memory exists
    if (await hasSimilarMemory(workspaceId, summarized.summary)) {
      return { stored: false, reason: 'similar_exists' };
    }

    const memoryContent = [
      `[msg:${message.id}] Discord — ${summarized.classification}`,
      `From: @${message.author.username} in channel ${message.channel_id}`,
      `Summary: ${summarized.summary}`,
      `Entities: ${summarized.keyEntities.join(', ')}`,
      '',
      `Original: ${sanitizedContent.slice(0, 500)}`,
    ].join('\n');

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('agent_memory')
      .insert({
        workspace_id: workspaceId,
        content: memoryContent,
        category: 'discord_conversation',
        source: 'discord',
        metadata: {
          discord_message_id: message.id,
          discord_channel_id: message.channel_id,
          discord_guild_id: message.guild_id ?? null,
          discord_author_id: message.author.id,
          discord_author_username: message.author.username,
          classification: summarized.classification,
          key_entities: summarized.keyEntities,
          timestamp: message.timestamp,
        },
      })
      .select('id')
      .single();

    if (error) {
      console.error('[discord-memory-ingest] Failed to store summarized memory:', error);
      return { stored: false, reason: 'db_error' };
    }

    return {
      stored: true,
      reason: 'summarized',
      memoryId: data.id,
      classification: summarized.classification,
    };
  }

  // Fallback: store raw (original behavior)
  return ingestDiscordMessage(message, workspaceId);
}

// ── Message Accumulation for Batch Summarization ──────────────────────────

/**
 * Accumulate a message for batch processing.
 * Messages are buffered per workspace and periodically summarized.
 */
export function accumulateMessage(message: GatewayMessage, workspaceId: string): void {
  const buffer = messageBuffer.get(workspaceId) ?? [];

  buffer.push({
    message,
    workspaceId,
    timestamp: Date.now(),
  });

  // Cap buffer size
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }

  messageBuffer.set(workspaceId, buffer);
}

/**
 * Flush accumulated messages for a workspace, summarizing the batch.
 * Called periodically or when buffer reaches threshold.
 */
export async function flushAccumulatedMessages(
  workspaceId: string,
): Promise<BatchIngestResult | null> {
  const buffer = messageBuffer.get(workspaceId);
  if (!buffer || buffer.length < MIN_BATCH_SIZE) return null;

  // Take all messages and clear buffer
  const messages = buffer.splice(0);
  messageBuffer.set(workspaceId, []);

  let stored = 0;
  let skipped = 0;

  for (const { message } of messages) {
    const result = await ingestWithSummarization(message, workspaceId);
    if (result.stored) stored++;
    else skipped++;
  }

  return { processed: messages.length, stored, skipped };
}

/**
 * Start periodic batch flush for all workspaces.
 * Call once at startup. Returns cleanup function.
 */
export function startPeriodicFlush(): () => void {
  const interval = setInterval(async () => {
    for (const workspaceId of messageBuffer.keys()) {
      try {
        const result = await flushAccumulatedMessages(workspaceId);
        if (result && result.stored > 0) {
          console.log(
            `[discord-memory-ingest] Batch flush: workspace=${workspaceId} stored=${result.stored} skipped=${result.skipped}`,
          );
        }
      } catch (err) {
        console.error(`[discord-memory-ingest] Batch flush error for ${workspaceId}:`, err);
      }
    }
  }, BATCH_INTERVAL_MS);

  return () => clearInterval(interval);
}
