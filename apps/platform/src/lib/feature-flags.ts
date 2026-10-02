import { isFeatureEnabled, getFlag, evaluateAllFlags } from '@repo/db/feature-flags';
import type { FlagEvaluationContext } from '@repo/types';

/**
 * Build a flag evaluation context from session/auth data.
 * Call this in server components or API routes where session is available.
 */
export function buildFlagContext(session: {
  user: { id: string; email?: string };
  plan?: string;
}): FlagEvaluationContext {
  const isDev =
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_APP_URL?.includes('localhost');

  return {
    userId: session.user.id,
    email: session.user.email,
    plan: session.plan,
    environment: isDev ? 'development' : 'production',
  };
}

// Re-export for convenience
export { isFeatureEnabled, getFlag, evaluateAllFlags };
