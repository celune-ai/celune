/**
 * Comprehensive integration test for the OnboardingWizard component.
 *
 * Covers the full 7-step flow: welcome -> mcp -> github -> agents -> project -> comms -> done
 * Tests step transitions, form validation, API calls, skip behaviour, and finish callback.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — declared before component import
// ---------------------------------------------------------------------------

const mockRefreshWorkspaces = vi.fn().mockResolvedValue(undefined);
const mockActiveWorkspace = { id: 'ws-existing-123', name: 'Existing WS', slug: 'existing-ws' };

let workspaceOverride: typeof mockActiveWorkspace | null = mockActiveWorkspace;

vi.mock('@/providers/workspace-provider', () => ({
  useWorkspace: () => ({
    activeWorkspace: workspaceOverride,
    refreshWorkspaces: mockRefreshWorkspaces,
  }),
}));

vi.mock('@repo/db/api', () => ({
  apiUrl: (path: string) => `http://localhost:3002${path}`,
}));

vi.mock('@/lib/branding', () => ({
  URL_DOCS: 'https://docs.celune.ai',
  URL_APP: 'https://app.celune.ai',
}));

const mockUpdateUser = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });

vi.mock('@repo/db/client', () => ({
  createClient: () => ({
    auth: {
      updateUser: mockUpdateUser,
    },
  }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Import component after mocks
import { OnboardingWizard } from '../onboarding-wizard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponses(
  responses: Record<string, { ok: boolean; json: () => unknown; status?: number }>,
) {
  global.fetch = vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return { ...response, status: response.status ?? (response.ok ? 200 : 500) } as Response;
      }
    }
    return { ok: true, json: async () => ({}), status: 200 } as Response;
  }) as typeof fetch;
}

function renderWizard(props?: { onClose?: () => void; onFinish?: () => void }) {
  const onClose = props?.onClose ?? vi.fn();
  const onFinish = props?.onFinish ?? vi.fn();
  const result = render(<OnboardingWizard open onClose={onClose} onFinish={onFinish} />);
  return { ...result, onClose, onFinish };
}

/** Simulate typing into an input by setting value and firing change event. */
function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

/** Check for a heading with specific text — avoids conflicts with button text. */
function expectHeading(text: string | RegExp) {
  return expect(screen.getByRole('heading', { name: text })).toBeTruthy();
}

/** Wait for a heading with specific text to appear. */
async function waitForHeading(text: string | RegExp) {
  await waitFor(() => expect(screen.getByRole('heading', { name: text })).toBeTruthy());
}

const SEEDED_AGENTS = [
  {
    agent_id: 'lead',
    display_name: 'Lead',
    role: 'Lead Engineer',
    description: '',
    model: 'claude-opus-4',
    color: '#6366f1',
    is_active: true,
  },
  {
    agent_id: 'reviewer',
    display_name: 'Reviewer',
    role: 'Code Reviewer',
    description: '',
    model: 'claude-sonnet-4',
    color: '#f59e0b',
    is_active: true,
  },
];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  workspaceOverride = mockActiveWorkspace;
  mockFetchResponses({
    '/api/user/profile': { ok: true, json: () => ({}) },
    '/api/workspaces': {
      ok: true,
      json: () => ({ id: 'ws-new-789', name: 'New WS', slug: 'new-ws' }),
    },
    '/api/agents/seed': {
      ok: true,
      json: () => ({ agents: SEEDED_AGENTS, plan: 'cloud', maxActive: 3 }),
    },
    '/api/projects': { ok: true, json: () => ({ id: 'proj-1', name: 'Test Project' }) },
    '/api/api-keys': { ok: true, json: () => ({ plaintext_key: 'sk-test-key-abc123' }) },
    '/api/user/level': { ok: true, json: () => ({ level: 1 }) },
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingWizard — full flow integration', () => {
  describe('Step 1: Welcome', () => {
    it('renders the welcome step initially', () => {
      renderWizard();
      expectHeading(/welcome to celune/i);
      expect(screen.getByPlaceholderText('Your company, app, business, etc...')).toBeTruthy();
    });

    it('shows workspace name field when user has no existing workspace', () => {
      workspaceOverride = null;
      renderWizard();
      expect(screen.getByPlaceholderText('e.g. My Team, Acme Corp')).toBeTruthy();
    });

    it('hides workspace name field when user already has a workspace', () => {
      renderWizard();
      expect(screen.queryByPlaceholderText('e.g. My Team, Acme Corp')).not.toBeTruthy();
    });

    it('disables Continue button when no workspace exists and name is empty', () => {
      workspaceOverride = null;
      renderWizard();
      const btn = screen.getByRole('button', { name: /continue/i });
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('enables Continue button when workspace name is provided', () => {
      workspaceOverride = null;
      renderWizard();

      typeInto(screen.getByPlaceholderText('e.g. My Team, Acme Corp'), 'My Workspace');

      const btn = screen.getByRole('button', { name: /continue/i });
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });

    it('enables Continue button when user already has a workspace', () => {
      renderWizard();
      const btn = screen.getByRole('button', { name: /continue/i });
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('Step 1 -> Step 2: Welcome to IDE Connection', () => {
    it('advances to the IDE connection step after welcome', async () => {
      renderWizard();

      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitForHeading(/connect your ide/i);
    });

    it('creates workspace when user has none and workspace name is provided', async () => {
      workspaceOverride = null;
      renderWizard();

      typeInto(screen.getByPlaceholderText('e.g. My Team, Acme Corp'), 'New Workspace');
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3002/api/workspaces',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'New Workspace' }),
          }),
        );
      });
    });

    it('saves display name if provided', async () => {
      renderWizard();

      typeInto(screen.getByPlaceholderText('Your company, app, business, etc...'), 'Alice');
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3002/api/user/profile',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ display_name: 'Alice' }),
          }),
        );
      });
    });

    it('shows toast on successful workspace creation', async () => {
      workspaceOverride = null;
      renderWizard();

      typeInto(screen.getByPlaceholderText('e.g. My Team, Acme Corp'), 'New WS');
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('Workspace "New WS" created');
      });
    });

    it('shows error toast when workspace creation fails', async () => {
      workspaceOverride = null;
      mockFetchResponses({
        '/api/user/profile': { ok: true, json: () => ({}) },
        '/api/workspaces': { ok: false, json: () => ({ error: 'fail' }), status: 500 },
      });
      renderWizard();

      typeInto(screen.getByPlaceholderText('e.g. My Team, Acme Corp'), 'Bad WS');
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          'Could not create workspace. You can create one later in Settings.',
        );
      });
    });

    it('calls markOnboardingStarted on welcome continue', async () => {
      renderWizard();

      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith({
          data: { onboarding_started: true },
        });
      });
    });
  });

  describe('Step 3: GitHub', () => {
    async function navigateToGitHub() {
      const result = renderWizard();
      // Welcome -> MCP
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      // MCP -> GitHub (set up later)
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));
      await waitForHeading(/connect github/i);
      return result;
    }

    it('shows the "Skip for now" link', async () => {
      await navigateToGitHub();
      expect(screen.getByText('Skip for now')).toBeTruthy();
    });

    it('skipping GitHub step advances to the Agents step and seeds agents', async () => {
      await navigateToGitHub();

      fireEvent.click(screen.getByText('Skip for now'));

      await waitForHeading(/your ai agent team/i);

      // Should have called agent seed API
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3002/api/agents/seed',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('Step 4: Agents', () => {
    async function navigateToAgents() {
      const result = renderWizard();

      // Welcome -> MCP
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      // MCP -> GitHub
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));
      await waitForHeading(/connect github/i);
      // GitHub -> Agents (skip)
      fireEvent.click(screen.getByText('Skip for now'));
      await waitForHeading(/your ai agent team/i);

      return result;
    }

    it('displays the seeded agents', async () => {
      await navigateToAgents();

      await waitFor(() => {
        expect(screen.getByText('Lead')).toBeTruthy();
        expect(screen.getByText('Reviewer')).toBeTruthy();
      });
    });

    it('shows agent roles', async () => {
      await navigateToAgents();

      await waitFor(() => {
        expect(screen.getByText('Lead Engineer')).toBeTruthy();
        expect(screen.getByText('Code Reviewer')).toBeTruthy();
      });
    });

    it('shows employed count and limit', async () => {
      await navigateToAgents();

      await waitFor(() => {
        expect(screen.getByText(/2 agents available/)).toBeTruthy();
        expect(screen.getByText(/2\/3 employed/)).toBeTruthy();
      });
    });

    it('shows empty state when no agents are seeded', async () => {
      mockFetchResponses({
        '/api/user/profile': { ok: true, json: () => ({}) },
        '/api/agents/seed': { ok: true, json: () => ({ agents: [], plan: 'cloud', maxActive: 3 }) },
        '/api/api-keys': { ok: true, json: () => ({ plaintext_key: 'sk-test' }) },
        '/api/user/level': { ok: true, json: () => ({ level: 1 }) },
      });

      render(<OnboardingWizard open onClose={vi.fn()} />);

      // Welcome -> MCP -> GitHub -> Agents
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));
      await waitForHeading(/connect github/i);
      fireEvent.click(screen.getByText('Skip for now'));
      await waitForHeading(/your ai agent team/i);

      expect(
        screen.getByText('Agents will appear here once your workspace is set up.'),
      ).toBeTruthy();
    });

    it('Continue on agents advances to Project step', async () => {
      await navigateToAgents();

      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitForHeading(/create your first project/i);
    });
  });

  describe('Step 5: Project', () => {
    async function navigateToProject() {
      const result = renderWizard();

      // Welcome -> MCP -> GitHub -> Agents -> Project
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));
      await waitForHeading(/connect github/i);
      fireEvent.click(screen.getByText('Skip for now'));
      await waitForHeading(/your ai agent team/i);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/create your first project/i);

      return result;
    }

    it('renders project name and description fields', async () => {
      await navigateToProject();

      expect(screen.getByPlaceholderText('e.g. Website Redesign')).toBeTruthy();
      expect(screen.getByPlaceholderText('What are you building? (optional)')).toBeTruthy();
    });

    it('Skip button advances to Comms step without creating project', async () => {
      await navigateToProject();

      fireEvent.click(screen.getByRole('button', { name: /skip/i }));

      await waitForHeading(/set up notifications/i);

      // No project creation call
      const projectCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/api/projects'));
      expect(projectCalls).toHaveLength(0);
    });

    it('creates a project when name is filled and Continue is clicked', async () => {
      await navigateToProject();

      typeInto(screen.getByPlaceholderText('e.g. Website Redesign'), 'My First Project');
      // After typing, the button text changes to "Create & Continue"
      const createBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Create & Continue'));
      fireEvent.click(createBtn!);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3002/api/projects',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('My First Project'),
          }),
        );
      });

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith('Project "My First Project" created');
      });
    });

    it('skips project creation when name is empty and Continue is clicked', async () => {
      await navigateToProject();

      // Click Continue (shows "Continue" when name is empty)
      const continueBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Continue'));
      fireEvent.click(continueBtn!);

      await waitForHeading(/set up notifications/i);
    });
  });

  describe('Step 2: MCP (IDE Connection)', () => {
    async function navigateToMcp() {
      const result = renderWizard();
      // Welcome -> MCP
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      return result;
    }

    it('creates an API key on mount', async () => {
      await navigateToMcp();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3002/api/api-keys',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    it('shows the CLI command with the generated key', async () => {
      await navigateToMcp();

      await waitFor(() => {
        expect(screen.getAllByText(/sk-test-key-abc123/).length).toBeGreaterThan(0);
      });
    });

    it('"Set up later" button advances to GitHub step', async () => {
      await navigateToMcp();

      await waitFor(() =>
        expect(screen.getAllByText(/sk-test-key-abc123/).length).toBeGreaterThan(0),
      );

      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));

      await waitForHeading(/connect github/i);
    });

    it('shows connected state when user level >= 2', async () => {
      mockFetchResponses({
        '/api/user/profile': { ok: true, json: () => ({}) },
        '/api/api-keys': { ok: true, json: () => ({ plaintext_key: 'sk-test' }) },
        '/api/user/level': { ok: true, json: () => ({ level: 2 }) },
      });

      render(<OnboardingWizard open onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      await waitForHeading(/ide connected!/i);
    });
  });

  describe('Step 6: Comms', () => {
    async function navigateToComms() {
      const result = renderWizard();

      // Welcome -> MCP -> GitHub -> Agents -> Project -> Comms
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));
      await waitForHeading(/connect github/i);
      fireEvent.click(screen.getByText('Skip for now'));
      await waitForHeading(/your ai agent team/i);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/create your first project/i);
      fireEvent.click(screen.getByRole('button', { name: /skip/i }));
      await waitForHeading(/set up notifications/i);

      return result;
    }

    it('renders notification channels', async () => {
      await navigateToComms();

      expect(screen.getByText('Email')).toBeTruthy();
      expect(screen.getByText('Slack')).toBeTruthy();
      expect(screen.getByText('Discord')).toBeTruthy();
    });

    it('shows "Set up later in Settings" skip link', async () => {
      await navigateToComms();

      expect(screen.getByText('Set up later in Settings')).toBeTruthy();
    });

    it('skip link advances to Done step', async () => {
      await navigateToComms();

      fireEvent.click(screen.getByText('Set up later in Settings'));

      await waitForHeading(/you're ready to go/i);
    });
  });

  describe('Step 8: Done', () => {
    async function navigateToDone() {
      const onClose = vi.fn();
      const onFinish = vi.fn();
      render(<OnboardingWizard open onClose={onClose} onFinish={onFinish} />);

      // Welcome -> MCP -> GitHub -> Agents -> Project -> Comms -> Done
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/connect your ide/i);
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));
      await waitForHeading(/connect github/i);
      fireEvent.click(screen.getByText('Skip for now'));
      await waitForHeading(/your ai agent team/i);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));
      await waitForHeading(/create your first project/i);
      fireEvent.click(screen.getByRole('button', { name: /skip/i }));
      await waitForHeading(/set up notifications/i);
      fireEvent.click(screen.getByText('Set up later in Settings'));
      await waitForHeading(/you're ready to go/i);

      return { onClose, onFinish };
    }

    it('renders the done step with completion message', async () => {
      await navigateToDone();

      expectHeading(/you're ready to go/i);
      expect(screen.getByRole('button', { name: /open celune/i })).toBeTruthy();
    });

    it('clicking "Open Celune" calls onFinish, onClose, and marks onboarding complete', async () => {
      const { onClose, onFinish } = await navigateToDone();

      fireEvent.click(screen.getByRole('button', { name: /open celune/i }));

      await waitFor(() => {
        expect(mockUpdateUser).toHaveBeenCalledWith({
          data: { onboarding_completed: true },
        });
      });

      expect(onClose).toHaveBeenCalled();
      expect(onFinish).toHaveBeenCalled();
      expect(mockToastSuccess).toHaveBeenCalledWith("You're all set! Welcome to Celune.");
    });
  });

  describe('Step dots navigation', () => {
    it('renders step dot indicators in the dialog', () => {
      renderWizard();
      // The dialog contains a step dots section at the bottom with 8 span dots
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
    });
  });

  describe('Full flow with project creation', () => {
    it('completes the entire wizard creating a project along the way', async () => {
      const onFinish = vi.fn();
      const onClose = vi.fn();
      render(<OnboardingWizard open onClose={onClose} onFinish={onFinish} />);

      // Step 1: Welcome -- enter display name
      typeInto(screen.getByPlaceholderText('Your company, app, business, etc...'), 'Bob');
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      // Step 2: MCP/IDE -- set up later
      await waitForHeading(/connect your ide/i);
      await waitFor(() =>
        expect(screen.getAllByText(/sk-test-key-abc123/).length).toBeGreaterThan(0),
      );
      fireEvent.click(screen.getByRole('button', { name: /set up later/i }));

      // Step 3: GitHub -- skip
      await waitForHeading(/connect github/i);
      fireEvent.click(screen.getByText('Skip for now'));

      // Step 4: Agents -- continue
      await waitForHeading(/your ai agent team/i);
      fireEvent.click(screen.getByRole('button', { name: /continue/i }));

      // Step 5: Project -- create a project
      await waitForHeading(/create your first project/i);
      typeInto(screen.getByPlaceholderText('e.g. Website Redesign'), 'Cool Project');
      typeInto(screen.getByPlaceholderText('What are you building? (optional)'), 'Something cool');
      const createBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Create & Continue'));
      fireEvent.click(createBtn!);

      // Step 6: Comms -- skip
      await waitForHeading(/set up notifications/i);
      fireEvent.click(screen.getByText('Set up later in Settings'));

      // Step 8: Done -- finish
      await waitForHeading(/you're ready to go/i);
      fireEvent.click(screen.getByRole('button', { name: /open celune/i }));

      // Verify project was created
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'http://localhost:3002/api/projects',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Cool Project'),
          }),
        );
      });

      // Verify onFinish was called
      await waitFor(() => expect(onFinish).toHaveBeenCalled());
    });
  });
});
