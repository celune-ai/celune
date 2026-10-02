/**
 * Discord Memory Ingest Tests
 *
 * Tests the message filtering, relevance checking, and memory storage
 * logic for passive Discord message ingestion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('../guardrails/pii-detector', () => ({
  redactPii: vi.fn((text: string) => text),
}));

// Chainable Supabase mock with per-table responses
type TableResponses = Record<string, { data: unknown; error?: unknown; count?: number }>;
let tableResponses: TableResponses = {};

function createTableRouter() {
  function createChain(resolvedValue: { data: unknown; error?: unknown; count?: number }) {
    const chain: Record<string, unknown> = {};
    const methods = [
      'from',
      'select',
      'insert',
      'update',
      'delete',
      'eq',
      'neq',
      'in',
      'gte',
      'lte',
      'ilike',
      'like',
      'textSearch',
      'order',
      'limit',
      'maybeSingle',
      'single',
    ];
    for (const method of methods) {
      chain[method] = vi.fn(() => chain);
    }
    (chain.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
    (chain.single as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
    (chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue(resolvedValue);
    return chain;
  }

  return {
    from: vi.fn((table: string) => {
      const response = tableResponses[table] ?? { data: null, count: 0 };
      return createChain(response);
    }),
  };
}

let mockSupabase: ReturnType<typeof createTableRouter>;

const { ingestDiscordMessage, batchIngestMessages } = await import('../discord-memory-ingest');

// ── Helpers ─────────────────────────────────────────────────────────────────

interface MessageOverrides {
  id?: string;
  content?: string;
  bot?: boolean;
  username?: string;
}

function makeMessage(overrides: MessageOverrides = {}) {
  return {
    id: overrides.id ?? `msg-${Date.now()}-${Math.random()}`,
    channel_id: 'ch-1',
    guild_id: 'guild-1',
    author: {
      id: 'author-1',
      username: overrides.username ?? 'testuser',
      bot: overrides.bot ?? false,
      discriminator: '0001',
    },
    content:
      overrides.content ?? 'This is a discussion about the launch campaign and deployment strategy',
    timestamp: new Date().toISOString(),
    mentions: [],
    referenced_message: null,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Discord Memory Ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {
      // Default: no duplicates, relevant keywords, successful insert
      agent_memory: { data: { id: 'mem-1' }, count: 0 },
      projects: { data: [{ name: 'Launch Campaign' }] },
      tasks: { data: [{ title: 'Deploy to production' }] },
    };
    mockSupabase = createTableRouter();
  });

  // ── Message filtering ─────────────────────────────────────────────────

  describe('Message filtering', () => {
    it('skips bot messages', async () => {
      const msg = makeMessage({ bot: true });
      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('bot_message');
    });

    it('skips short messages (less than 10 characters)', async () => {
      const msg = makeMessage({ content: 'hi' });
      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('too_short');
    });

    it('skips command messages starting with /', async () => {
      const msg = makeMessage({ content: '/help me with something' });
      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('command');
    });

    it('skips command messages starting with !', async () => {
      const msg = makeMessage({ content: '!ban @someone for spamming' });
      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('command');
    });

    it('skips bare URL messages', async () => {
      const msg = makeMessage({ content: 'https://example.com/some/path' });
      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('bare_url');
    });
  });

  // ── Relevant message storage ──────────────────────────────────────────

  describe('Relevant message storage', () => {
    it('stores messages that match workspace project keywords', async () => {
      const msg = makeMessage({
        content: 'We should update the launch campaign timeline to include Q3 milestones',
      });

      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(true);
      expect(result.reason).toBe('relevant');
      expect(result.memoryId).toBe('mem-1');
    });

    it('returns not_relevant for messages that match no keywords', async () => {
      tableResponses = {
        agent_memory: { data: null, count: 0 },
        projects: { data: [{ name: 'Unrelated Project' }] },
        tasks: { data: [{ title: 'Unrelated Task' }] },
      };

      const msg = makeMessage({
        content: 'Just chatting about random weekend plans and food recipes',
      });

      const result = await ingestDiscordMessage(msg, 'ws-1');
      expect(result.stored).toBe(false);
      expect(result.reason).toBe('not_relevant');
    });
  });

  // ── Batch ingestion ───────────────────────────────────────────────────

  describe('batchIngestMessages', () => {
    it('throws when batch exceeds MAX_BATCH_SIZE (100)', async () => {
      const messages = Array.from({ length: 101 }, (_, i) =>
        makeMessage({ id: `msg-${i}`, content: 'Valid message about launch campaign' }),
      );

      await expect(batchIngestMessages(messages, 'ws-1')).rejects.toThrow(
        'Batch size 101 exceeds maximum of 100',
      );
    });

    it('processes messages within batch size limit', async () => {
      const messages = [
        makeMessage({ content: 'Discussion about the launch campaign goals' }),
        makeMessage({ bot: true, content: 'Bot response about launch campaign' }),
        makeMessage({ content: 'hi' }),
      ];

      const result = await batchIngestMessages(messages, 'ws-1');
      expect(result.processed).toBe(3);
      // 1 stored (relevant), 2 skipped (bot + too_short)
      expect(result.stored + result.skipped).toBe(3);
    });

    it('returns correct counts for empty batch', async () => {
      const result = await batchIngestMessages([], 'ws-1');
      expect(result.processed).toBe(0);
      expect(result.stored).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });
});
