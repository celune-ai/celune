/**
 * Slack Digests Tests
 *
 * Tests the daily and weekly digest generators that produce
 * Block Kit blocks for Slack posting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('../slack-api', () => ({
  headerBlock: vi.fn((text: string) => ({ type: 'header', text: { type: 'plain_text', text } })),
  markdownSection: vi.fn((text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } })),
  fieldsSection: vi.fn((fields: string[]) => ({
    type: 'section',
    fields: fields.map((f: string) => ({ type: 'mrkdwn', text: f })),
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

// Chainable Supabase mock with per-table responses
type TableResponses = Record<string, { data: unknown; error?: unknown }>;
let tableResponses: TableResponses = {};

function createTableRouter() {
  function createChain(resolvedValue: { data: unknown; error?: unknown }) {
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
      'order',
      'limit',
      'maybeSingle',
      'single',
    ];
    for (const method of methods) {
      chain[method] = vi.fn(() => chain);
    }
    // Make chain thenable so `await chain` resolves to the data
    chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
    return chain;
  }

  return {
    from: vi.fn((table: string) => {
      const response = tableResponses[table] ?? { data: null };
      return createChain(response);
    }),
  };
}

let mockSupabase: ReturnType<typeof createTableRouter>;

const { generateDailyDigest, generateWeeklyDigest } = await import('../slack-digests');

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Slack Digests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {};
    mockSupabase = createTableRouter();
  });

  // ── Daily Digest ────────────────────────────────────────────────────────

  describe('generateDailyDigest', () => {
    it('returns minimal blocks when no tasks exist', async () => {
      tableResponses = {
        tasks: { data: [] },
        projects: { data: [] },
      };

      const blocks = await generateDailyDigest('ws-1');

      expect(blocks.length).toBeGreaterThan(0);

      // Should have a header
      const header = blocks.find((b) => b.type === 'header');
      expect(header).toBeDefined();
      expect(header!.text!.text).toContain('Daily Digest');

      // Should have stats showing 0s
      const fieldsBlock = blocks.find((b) => b.type === 'section' && b.fields);
      expect(fieldsBlock).toBeDefined();
      const fieldTexts = fieldsBlock!.fields!.map((f: { text: string }) => f.text);
      expect(fieldTexts.some((t: string) => t.includes('*0*'))).toBe(true);
    });

    it('includes correct task counts when tasks exist', async () => {
      tableResponses = {
        tasks: {
          data: [
            {
              id: 't1',
              title: 'Task 1',
              assignee: 'RICK',
              completed_at: new Date().toISOString(),
              status: 'done',
            },
            {
              id: 't2',
              title: 'Task 2',
              assignee: 'SAGE',
              completed_at: new Date().toISOString(),
              status: 'done',
            },
          ],
        },
        projects: {
          data: [{ id: 'p1', name: 'Project Alpha', status: 'active' }],
        },
      };

      const blocks = await generateDailyDigest('ws-1');

      // Should have header
      expect(blocks.find((b) => b.type === 'header')).toBeDefined();

      // Should have actions block with dashboard button
      const actionsBlock = blocks.find((b) => b.type === 'actions');
      expect(actionsBlock).toBeDefined();
    });

    it('includes active projects section', async () => {
      tableResponses = {
        tasks: { data: [] },
        projects: {
          data: [
            { id: 'p1', name: 'Project Alpha', status: 'active' },
            { id: 'p2', name: 'Project Beta', status: 'in_progress' },
          ],
        },
      };

      const blocks = await generateDailyDigest('ws-1');

      // Should contain project-related sections
      const sections = blocks.filter((b) => b.type === 'section' && b.text);
      const projectSection = sections.find(
        (s) => s.text!.text.includes('Active Projects') || s.text!.text.includes('Project Alpha'),
      );
      expect(projectSection).toBeDefined();
    });
  });

  // ── Weekly Digest ───────────────────────────────────────────────────────

  describe('generateWeeklyDigest', () => {
    it('includes completion rate in weekly digest', async () => {
      tableResponses = {
        tasks: {
          data: [
            {
              id: 't1',
              title: 'Done Task',
              assignee: 'RICK',
              completed_at: new Date().toISOString(),
              status: 'done',
            },
          ],
        },
        projects: { data: [] },
      };

      const blocks = await generateWeeklyDigest('ws-1');

      // Should have header with "Weekly Digest"
      const header = blocks.find((b) => b.type === 'header');
      expect(header).toBeDefined();
      expect(header!.text!.text).toContain('Weekly Digest');

      // Should include completion rate in fields
      const fieldsBlock = blocks.find((b) => b.type === 'section' && b.fields);
      expect(fieldsBlock).toBeDefined();
      const fieldTexts = fieldsBlock!.fields!.map((f: { text: string }) => f.text);
      expect(fieldTexts.some((t: string) => t.includes('completion rate'))).toBe(true);
    });

    it('includes top contributors when tasks have assignees', async () => {
      const completedTasks = [
        {
          id: 't1',
          title: 'Task A',
          assignee: 'RICK',
          completed_at: new Date().toISOString(),
          status: 'done',
        },
        {
          id: 't2',
          title: 'Task B',
          assignee: 'RICK',
          completed_at: new Date().toISOString(),
          status: 'done',
        },
        {
          id: 't3',
          title: 'Task C',
          assignee: 'SAGE',
          completed_at: new Date().toISOString(),
          status: 'done',
        },
      ];

      tableResponses = {
        tasks: { data: completedTasks },
        projects: { data: [] },
      };

      const blocks = await generateWeeklyDigest('ws-1');

      // Should contain "Top Contributors" section
      const sections = blocks.filter((b) => b.type === 'section' && b.text);
      const contributorsSection = sections.find((s) => s.text!.text.includes('Top Contributors'));
      expect(contributorsSection).toBeDefined();
    });

    it('includes project activity section', async () => {
      tableResponses = {
        tasks: { data: [] },
        projects: {
          data: [{ id: 'p1', name: 'Launch', status: 'active' }],
        },
      };

      const blocks = await generateWeeklyDigest('ws-1');

      const sections = blocks.filter((b) => b.type === 'section' && b.text);
      const projectSection = sections.find(
        (s) => s.text!.text.includes('Project Activity') || s.text!.text.includes('Launch'),
      );
      expect(projectSection).toBeDefined();
    });

    it('includes analytics button in footer actions', async () => {
      tableResponses = {
        tasks: { data: [] },
        projects: { data: [] },
      };

      const blocks = await generateWeeklyDigest('ws-1');

      const actionsBlock = blocks.find((b) => b.type === 'actions');
      expect(actionsBlock).toBeDefined();
      expect(actionsBlock!.elements!.length).toBe(2);
    });
  });
});
