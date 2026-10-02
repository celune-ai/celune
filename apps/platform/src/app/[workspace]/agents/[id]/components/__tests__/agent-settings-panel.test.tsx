/**
 * @vitest-environment jsdom
 *
 * Tests for AgentSettingsPanel.
 *
 * Covers:
 * - Renders with initial values
 * - Dirty state triggers on field changes
 * - Save calls API with correct payload
 * - Delete 2-step confirmation flow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockFetchJson = vi.fn().mockResolvedValue({});

vi.mock('@/lib/fetch-json', () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { AgentSettingsPanel } from '../agent-settings-panel';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AgentSettingsPanel', () => {
  const defaultProps = {
    agentId: 'test-agent-123',
    workspaceId: 'ws-456',
    initialValues: {
      display_name: 'Test Agent',
      role: 'Analyst',
      description: 'Analyzes data',
      color: '#3B82F6',
      persona_prompt: 'You are a test agent.',
      model: 'claude-sonnet-4-6',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with initial values', () => {
    render(<AgentSettingsPanel {...defaultProps} />);
    expect(screen.getByDisplayValue('Test Agent')).toBeDefined();
    expect(screen.getByDisplayValue('Analyst')).toBeDefined();
    expect(screen.getByDisplayValue('Analyzes data')).toBeDefined();
    expect(screen.getByDisplayValue('You are a test agent.')).toBeDefined();
  });

  it('shows Save button only when dirty', () => {
    render(<AgentSettingsPanel {...defaultProps} />);
    // No save button initially
    expect(screen.queryByText('Save Settings')).toBeNull();

    // Change a field
    fireEvent.change(screen.getByDisplayValue('Test Agent'), {
      target: { value: 'Updated Agent' },
    });

    // Save button appears
    expect(screen.getByText('Save Settings')).toBeDefined();
  });

  it('calls API on save with correct payload', async () => {
    mockFetchJson.mockResolvedValueOnce({ agent_id: 'test-agent-123' });
    render(<AgentSettingsPanel {...defaultProps} />);

    // Make dirty
    fireEvent.change(screen.getByDisplayValue('Test Agent'), {
      target: { value: 'Updated Agent' },
    });

    // Click save
    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockFetchJson).toHaveBeenCalledWith(
        '/api/agents/test-agent-123/config?workspace_id=ws-456',
        expect.objectContaining({
          method: 'PUT',
        }),
      );
    });
  });

  it('shows 2-step delete confirmation', () => {
    render(<AgentSettingsPanel {...defaultProps} />);

    // First click shows confirm
    fireEvent.click(screen.getByText('Remove'));
    expect(screen.getByText('Confirm Remove')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('cancel hides confirm delete buttons', () => {
    render(<AgentSettingsPanel {...defaultProps} />);

    fireEvent.click(screen.getByText('Remove'));
    expect(screen.getByText('Confirm Remove')).toBeDefined();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Confirm Remove')).toBeNull();
    expect(screen.getByText('Remove')).toBeDefined();
  });

  it('calls delete API on confirm', async () => {
    const onDeleted = vi.fn();
    mockFetchJson.mockResolvedValueOnce({ success: true });
    render(<AgentSettingsPanel {...defaultProps} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByText('Confirm Remove'));

    await waitFor(() => {
      expect(mockFetchJson).toHaveBeenCalledWith(
        '/api/agents/test-agent-123/config?workspace_id=ws-456',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('disables save when display name is empty', () => {
    render(<AgentSettingsPanel {...defaultProps} />);

    fireEvent.change(screen.getByDisplayValue('Test Agent'), {
      target: { value: '' },
    });

    const saveButton = screen.getByText('Save Settings');
    expect(saveButton.hasAttribute('disabled')).toBe(true);
  });
});
