/**
 * Slack Notifications Tests
 *
 * Tests rate limiting, notification preferences, and Block Kit message
 * construction for the Slack notification dispatch service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('@repo/notifications/decrypt-webhook', () => ({
  decryptBotToken: vi.fn(() => 'xoxb-test-bot-token'),
}));

vi.mock('../slack-api', () => ({
  chatPostMessage: vi.fn(),
  conversationsOpen: vi.fn(() => 'DM-CHANNEL-123'),
  headerBlock: vi.fn((text: string) => ({ type: 'header', text: { type: 'plain_text', text } })),
  markdownSection: vi.fn((text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } })),
  fieldsSection: vi.fn((fields: string[]) => ({
    type: 'section',
    fields: fields.map((f) => ({ type: 'mrkdwn', text: f })),
  })),
  divider: vi.fn(() => ({ type: 'divider' })),
  actionsBlock: vi.fn((elements: unknown[], blockId: string) => ({
    type: 'actions',
    block_id: blockId,
    elements,
  })),
  button: vi.fn((text: string, actionId: string, opts?: Record<string, unknown>) => ({
    type: 'button',
    text: { type: 'plain_text', text },
    action_id: actionId,
    ...opts,
  })),
  contextBlock: vi.fn((elements: unknown[]) => ({ type: 'context', elements })),
}));

// Chainable Supabase mock
function createChainableMock(resolvedValue: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'from',
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'gte',
    'lte',
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

let mockSupabase: ReturnType<typeof createChainableMock>;

const { chatPostMessage, conversationsOpen } = await import('../slack-api');
const {
  sendTaskAssignedNotification,
  sendDeadlineWarning,
  sendTaskCompletedNotification,
  sendProjectStatusUpdate,
} = await import('../slack-notifications');

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockTask = {
  id: 'task-1',
  title: 'Fix the bug',
  status: 'in_progress',
  priority: 'high',
  assignee: 'RICK',
  workspace_id: 'ws-1',
  due_date: '2026-04-01',
  description: 'A critical bug that needs fixing immediately.',
};

const mockProject = {
  id: 'proj-1',
  name: 'Launch Campaign',
  status: 'active',
  workspace_id: 'ws-1',
  progress: 65,
  task_count: 20,
  completed_count: 13,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Slack Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: active slack connection with bot token + channel + enabled prefs
    mockSupabase = createChainableMock({
      data: {
        slack_team_id: 'T123',
        bot_token_encrypted: 'enc',
        bot_token_iv: 'iv',
        installation_type: 'full',
        slack_channel_id: 'C-GENERAL',
      },
    });
    // Override notification_preferences to return enabled
    const origFrom = mockSupabase.from as ReturnType<typeof vi.fn>;
    origFrom.mockImplementation((table: string) => {
      if (table === 'notification_preferences') {
        return createChainableMock({
          data: [
            {
              event_types: ['task.assigned', 'task.deadline', 'task.completed', 'project.status'],
              is_enabled: true,
            },
          ],
        });
      }
      return mockSupabase;
    });
  });

  // ── Rate limiting ───────────────────────────────────────────────────────

  describe('Rate limiting', () => {
    it('blocks the 11th notification in an hour for the same user', async () => {
      const slackId = `rate-limit-user-${Date.now()}`;

      // Send 10 — should all succeed
      for (let i = 0; i < 10; i++) {
        const result = await sendTaskAssignedNotification('ws-1', mockTask, slackId);
        expect(result).toBe(true);
      }

      // 11th should be rate-limited
      const result = await sendTaskAssignedNotification('ws-1', mockTask, slackId);
      expect(result).toBe(false);
    });
  });

  // ── Notification preferences ──────────────────────────────────────────

  describe('Notification preferences', () => {
    it('returns false when event type is disabled', async () => {
      const origFrom = mockSupabase.from as ReturnType<typeof vi.fn>;
      origFrom.mockImplementation((table: string) => {
        if (table === 'notification_preferences') {
          // Return prefs that do NOT include task.assigned
          return createChainableMock({
            data: [{ event_types: ['task.completed'], is_enabled: true }],
          });
        }
        return mockSupabase;
      });

      const uniqueSlackId = `pref-test-${Date.now()}`;
      const result = await sendTaskAssignedNotification('ws-1', mockTask, uniqueSlackId);
      expect(result).toBe(false);
    });
  });

  // ── Task assigned notification ────────────────────────────────────────

  describe('sendTaskAssignedNotification', () => {
    it('builds correct Block Kit message with priority and status fields', async () => {
      const uniqueSlackId = `assigned-test-${Date.now()}`;
      const result = await sendTaskAssignedNotification('ws-1', mockTask, uniqueSlackId);
      expect(result).toBe(true);

      // Verify DM channel was opened
      expect(conversationsOpen).toHaveBeenCalledWith('xoxb-test-bot-token', uniqueSlackId);

      // Verify message was sent to the DM channel
      expect(chatPostMessage).toHaveBeenCalledWith(
        'xoxb-test-bot-token',
        'DM-CHANNEL-123',
        expect.stringContaining('Fix the bug'),
        expect.objectContaining({ blocks: expect.any(Array) }),
      );
    });

    it('returns false when no slack connection exists', async () => {
      mockSupabase = createChainableMock({ data: null });
      const uniqueSlackId = `no-conn-${Date.now()}`;
      const result = await sendTaskAssignedNotification('ws-1', mockTask, uniqueSlackId);
      expect(result).toBe(false);
    });
  });

  // ── Deadline warning ──────────────────────────────────────────────────

  describe('sendDeadlineWarning', () => {
    it('sends 24h deadline warning to channel', async () => {
      const result = await sendDeadlineWarning('ws-1', mockTask, '24h');
      expect(result).toBe(true);
      expect(chatPostMessage).toHaveBeenCalledWith(
        'xoxb-test-bot-token',
        'C-GENERAL',
        expect.stringContaining('Deadline warning'),
        expect.objectContaining({ blocks: expect.any(Array) }),
      );
    });

    it('sends 1h urgent deadline warning to channel', async () => {
      const result = await sendDeadlineWarning('ws-1', mockTask, '1h');
      expect(result).toBe(true);
      expect(chatPostMessage).toHaveBeenCalled();
    });
  });

  // ── Task completed ────────────────────────────────────────────────────

  describe('sendTaskCompletedNotification', () => {
    it('posts to the default channel', async () => {
      const result = await sendTaskCompletedNotification('ws-1', mockTask);
      expect(result).toBe(true);
      expect(chatPostMessage).toHaveBeenCalledWith(
        'xoxb-test-bot-token',
        'C-GENERAL',
        expect.stringContaining('Task completed'),
        expect.any(Object),
      );
    });

    it('posts to a specific channel when provided', async () => {
      const result = await sendTaskCompletedNotification('ws-1', mockTask, 'C-CUSTOM');
      expect(result).toBe(true);
      expect(chatPostMessage).toHaveBeenCalledWith(
        'xoxb-test-bot-token',
        'C-CUSTOM',
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  // ── Project status update ─────────────────────────────────────────────

  describe('sendProjectStatusUpdate', () => {
    it('sends a project update with progress bar', async () => {
      const result = await sendProjectStatusUpdate('ws-1', mockProject, 'C-UPDATES');
      expect(result).toBe(true);
      expect(chatPostMessage).toHaveBeenCalledWith(
        'xoxb-test-bot-token',
        'C-UPDATES',
        expect.stringContaining('Launch Campaign'),
        expect.objectContaining({ blocks: expect.any(Array) }),
      );
    });
  });
});
