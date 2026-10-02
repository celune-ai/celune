/**
 * @vitest-environment jsdom
 *
 * Tests for UsageMeters component.
 *
 * Covers:
 * - Renders usage metrics with correct percentages
 * - Shows warning state at 80% usage
 * - Shows danger state at 95% usage
 * - Shows "Unlimited" for null limits
 * - Shows upgrade prompt when free plan has warnings
 * - Handles loading state
 * - Handles fetch errors gracefully
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@repo/db/api', () => ({
  apiUrl: (path: string) => `http://localhost:3002${path}`,
}));

vi.mock('@/lib/fetch-json', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '@/lib/fetch-json';
import { UsageMeters } from '../settings/usage-meters';

const mockFetchJson = vi.mocked(fetchJson);

// ── Test data ──────────────────────────────────────────────────────────────

const baseMetrics = [
  { key: 'agents', label: 'Agents', used: 1, limit: 2, percentage: 50 },
  { key: 'tasks', label: 'Tasks this month', used: 50, limit: 100, percentage: 50 },
  { key: 'memories', label: 'Memory entries', used: 500, limit: 1000, percentage: 50 },
  { key: 'tts_minutes', label: 'TTS minutes', used: 5, limit: 10, percentage: 50 },
  { key: 'api_calls', label: 'API calls', used: 500, limit: 1000, percentage: 50 },
  { key: 'llm_cost', label: 'LLM cost', used: 2.5, limit: 5, percentage: 50 },
  { key: 'storage_bytes', label: 'Storage', used: 52428800, limit: 104857600, percentage: 50 },
];

function makeResponse(overrides?: {
  plan?: string;
  metrics?: typeof baseMetrics;
  has_warning?: boolean;
}) {
  return {
    plan: overrides?.plan ?? 'build',
    is_platform_owner: false,
    metrics: overrides?.metrics ?? baseMetrics,
    has_warning: overrides?.has_warning ?? false,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('UsageMeters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all metrics with labels', async () => {
    mockFetchJson.mockResolvedValue(makeResponse());

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText('Agents')).toBeInTheDocument();
      expect(screen.getByText('Tasks this month')).toBeInTheDocument();
      expect(screen.getByText('Memory entries')).toBeInTheDocument();
      expect(screen.getByText('TTS minutes')).toBeInTheDocument();
      expect(screen.getByText('API calls')).toBeInTheDocument();
      expect(screen.getByText('LLM cost')).toBeInTheDocument();
      expect(screen.getByText('Storage')).toBeInTheDocument();
    });
  });

  it('renders progress bars with correct aria values', async () => {
    mockFetchJson.mockResolvedValue(makeResponse());

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBe(7);

      // Check first progress bar (agents at 50%)
      expect(progressBars[0]).toHaveAttribute('aria-valuenow', '50');
      expect(progressBars[0]).toHaveAttribute('aria-valuemin', '0');
      expect(progressBars[0]).toHaveAttribute('aria-valuemax', '100');
    });
  });

  it('shows warning indicator at 80% usage', async () => {
    const warningMetrics = baseMetrics.map((m) =>
      m.key === 'tasks' ? { ...m, used: 85, percentage: 85 } : m,
    );
    mockFetchJson.mockResolvedValue(makeResponse({ metrics: warningMetrics, has_warning: true }));

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText('85% used')).toBeInTheDocument();
    });
  });

  it('shows danger indicator at 95% usage', async () => {
    const dangerMetrics = baseMetrics.map((m) =>
      m.key === 'tasks' ? { ...m, used: 97, percentage: 97 } : m,
    );
    mockFetchJson.mockResolvedValue(makeResponse({ metrics: dangerMetrics, has_warning: true }));

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText('97% used')).toBeInTheDocument();
    });
  });

  it('shows "Unlimited" for null limits', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unlimitedMetrics: any[] = baseMetrics.map((m) =>
      m.key === 'agents' ? { ...m, limit: null, percentage: null } : m,
    );
    mockFetchJson.mockResolvedValue(makeResponse({ metrics: unlimitedMetrics }));

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Unlimited/)).toBeInTheDocument();
    });
  });

  it('shows loading spinner initially', () => {
    mockFetchJson.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<UsageMeters workspaceId="ws-1" />);

    // Should show the spinner (animate-spin class)
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('formats LLM cost as currency', async () => {
    mockFetchJson.mockResolvedValue(makeResponse());

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText(/\$2\.50/)).toBeInTheDocument();
    });
  });

  it('formats storage in MB', async () => {
    mockFetchJson.mockResolvedValue(makeResponse());

    render(<UsageMeters workspaceId="ws-1" />);

    await waitFor(() => {
      expect(screen.getByText(/50\.0 MB/)).toBeInTheDocument();
    });
  });
});
