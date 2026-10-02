import { vi } from 'vitest';

/**
 * Standard security module mocks for API route tests.
 *
 * Import this file at the top of any API test to auto-mock
 * CSRF, rate limiting, permissions, and UUID validation.
 *
 * If a test needs custom behavior for any of these modules,
 * add a vi.mock() call in the test file — it will override the
 * shared mock for that specific module.
 */

// Mock CSRF validation — allow all origins in tests
vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
}));

// Mock rate limiter — no rate limiting in tests
vi.mock('@/lib/rate-limiter', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_WRITE: { limit: 60, windowMs: 60_000 },
  RATE_READ: { limit: 120, windowMs: 60_000 },
  RATE_AI: { limit: 20, windowMs: 60_000 },
  RATE_AUTH: { limit: 5, windowMs: 60_000 },
}));

// Mock permissions — allow all permissions in tests
vi.mock('@/lib/permissions', () => ({
  requirePermission: vi.fn(async () => ({
    userId: 'test-user-id',
    resolved: {
      role: null,
      permissions: new Set([
        'tasks:create',
        'tasks:read',
        'tasks:update',
        'tasks:delete',
        'projects:create',
        'projects:read',
        'projects:update',
        'projects:delete',
        'users:manage',
        'users:read',
        'settings:manage',
        'settings:read',
        'agents:configure',
        'agents:read',
        'billing:manage',
        'billing:read',
        'analytics:read',
        'webhooks:manage',
        'webhooks:read',
        'api_keys:manage',
        'api_keys:read',
        'audit_log:read',
      ]),
      isOwner: true,
      isPlatformOwner: true,
    },
  })),
}));

// Mock plan enforcement — allow all plans in tests (no trial lockout)
vi.mock('@/lib/plan-enforcement', () => ({
  requireActivePlan: vi.fn(async () => null),
  enforcePlanLimit: vi.fn(async () => null),
  resolveWorkspacePlan: vi.fn(async () => ({
    plan: 'pro',
    limits: {
      max_agents: 5,
      max_workspaces: 3,
      max_tasks_per_month: 1000,
      max_tts_minutes_per_month: 60,
      max_api_calls_per_month: 10000,
      max_llm_cost_per_month: 50,
      max_storage_bytes: 1073741824,
      max_memories: 50000,
      features: ['basic_dashboard', 'task_management'],
    },
    isPlatformOwner: false,
  })),
  getCurrentUsage: vi.fn(async () => ({
    tasks_this_month: 0,
    tts_minutes_this_month: 0,
    api_calls_this_month: 0,
    llm_cost_this_month: 0,
    agent_count: 0,
  })),
  getMemoryUsage: vi.fn(async () => ({ count: 0, limit: 50000, plan: 'pro' })),
  isFeatureAvailable: vi.fn(async () => true),
}));

// Mock UUID validation — real regex check (matches production behavior)
vi.mock('@repo/db/validation', () => ({
  isValidUuid: (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
}));
