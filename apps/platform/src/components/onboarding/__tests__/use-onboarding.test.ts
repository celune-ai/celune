import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---------- Mocks ----------

const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('@repo/db/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
    },
  }),
}));

// Import AFTER mocks are declared
import { useOnboarding, markOnboardingStarted, markOnboardingComplete } from '../use-onboarding';

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null });
});

// ---------- useOnboarding hook ----------

describe('useOnboarding', () => {
  it('returns { shouldShow: false, isBlocked: false, loading: false } when no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useOnboarding());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      shouldShow: false,
      isBlocked: false,
      loading: false,
    });
  });

  it('returns { shouldShow: true, isBlocked: false } when user has no onboarding flags', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', user_metadata: {} } },
    });

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      shouldShow: true,
      isBlocked: false,
      loading: false,
    });
  });

  it('returns { shouldShow: true, isBlocked: true } when onboarding_started but not completed', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          user_metadata: { onboarding_started: true },
        },
      },
    });

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      shouldShow: true,
      isBlocked: true,
      loading: false,
    });
  });

  it('returns { shouldShow: false, isBlocked: false } when onboarding_completed is true', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          user_metadata: {
            onboarding_started: true,
            onboarding_completed: true,
          },
        },
      },
    });

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      shouldShow: false,
      isBlocked: false,
      loading: false,
    });
  });

  it('returns safe defaults when getUser throws', async () => {
    mockGetUser.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current).toEqual({
      shouldShow: false,
      isBlocked: false,
      loading: false,
    });
  });
});

// ---------- markOnboardingStarted ----------

describe('markOnboardingStarted', () => {
  it('calls supabase.auth.updateUser with { data: { onboarding_started: true } }', async () => {
    await markOnboardingStarted();

    expect(mockUpdateUser).toHaveBeenCalledOnce();
    expect(mockUpdateUser).toHaveBeenCalledWith({
      data: { onboarding_started: true },
    });
  });
});

// ---------- markOnboardingComplete ----------

describe('markOnboardingComplete', () => {
  it('calls supabase.auth.updateUser with { data: { onboarding_completed: true } }', async () => {
    await markOnboardingComplete();

    expect(mockUpdateUser).toHaveBeenCalledOnce();
    expect(mockUpdateUser).toHaveBeenCalledWith({
      data: { onboarding_completed: true },
    });
  });
});
