'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@repo/db/client';
import { toast } from 'sonner';
import { isRateLimitError, parseRetryAfterSeconds, setLastProvider } from '@/lib/auth-helpers';
import { Spinner, LastUsedBadge } from '@/components/auth/auth-icons';
import { OAuthButtons, OAuthDivider } from '@/components/auth/oauth-buttons';
import { AuthLayout } from '@/components/auth/auth-layout';
import { URL_MARKETING } from '@/lib/branding';
import { MaskedInput } from '@/components/masked-input';
import {
  useRateLimit,
  useLastProvider,
  RateLimitBanner,
} from '@/components/auth/auth-form-wrapper';
import { AuthFormSkeleton } from '@/components/auth/auth-form-skeleton';

function friendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Invalid email or password.';
  }
  return 'Unable to sign in. Please try again.';
}

function LoginForm() {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupGated, setSignupGated] = useState(true); // Default to gated (safe)
  const [oauthEnabled, setOauthEnabled] = useState(false); // Default to disabled (safe)
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  const { rateLimitSeconds, isRateLimited, startCountdown } = useRateLimit();
  const lastProvider = useLastProvider();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get('redirectTo') || '/';
  const redirectTo =
    rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';
  const message = searchParams.get('message');
  const errorParam = searchParams.get('error');
  const reason = searchParams.get('reason');
  const supabase = createClient();

  // Load public flags to check if signup is gated
  useEffect(() => {
    fetch('/api/flags/public')
      .then((r) => r.json())
      .then((flags) => {
        setSignupGated(flags.signup_gated === true);
        setOauthEnabled(flags.oauth_enabled === true);
        setFlagsLoaded(true);
      })
      .catch(() => {
        setSignupGated(true); // Fail closed — keep gated
        setOauthEnabled(false); // Fail closed — no OAuth
        setFlagsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (reason === 'session_expired') {
      toast.warning('Your session has expired. Please sign in again.');
    }
  }, [reason]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const status = (error as { status?: number }).status;
      if (isRateLimitError(error.message, status)) {
        startCountdown(parseRetryAfterSeconds(error.message));
        setError(null);
      } else {
        setError(friendlyError(error.message));
      }
      setLoading(false);
      return;
    }

    setLastProvider('email');
    fetch('/api/user/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'email' }),
    }).catch(() => {});
    router.push(redirectTo);
    router.refresh();
    // Reset loading after a timeout in case navigation hangs
    setTimeout(() => setLoading(false), 5000);
  }

  // Render the signup/access-code footer link
  function renderFooterLink() {
    if (!flagsLoaded) return null;

    if (signupGated) {
      return (
        <p className="text-center text-sm text-white/50">
          Need an access code?{' '}
          <a
            href={`${URL_MARKETING}#signup`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/80 transition-colors hover:text-white"
          >
            Join the waitlist
          </a>
        </p>
      );
    }

    return (
      <p className="text-center text-sm text-white/50">
        Don&apos;t have an account?{' '}
        <a href="/signup" className="text-white/80 transition-colors hover:text-white">
          Create Account
        </a>
      </p>
    );
  }

  function renderEmailFooterLink() {
    if (!flagsLoaded) return null;

    if (signupGated) {
      return (
        <a
          href={`${URL_MARKETING}#signup`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-white/50 transition-colors hover:text-white/80"
        >
          Join the waitlist
        </a>
      );
    }

    return (
      <a
        href="/signup"
        className="text-xs font-semibold text-white/50 transition-colors hover:text-white/80"
      >
        Create Account
      </a>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center">
        <p className="text-base text-white">Sign in to continue</p>
      </div>

      {errorParam === 'auth-callback-failed' && (
        <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-center text-sm text-red-400">
          That link has expired or already been used. Please try again.
        </p>
      )}

      {message === 'check-email' && (
        <p className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-center text-sm text-white/70">
          Check your email to confirm your account
        </p>
      )}
      {message === 'password-updated' && (
        <p className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-center text-sm text-white/70">
          Password updated — sign in with your new password
        </p>
      )}

      <RateLimitBanner seconds={rateLimitSeconds} />

      {oauthEnabled && (
        <>
          <OAuthButtons
            redirectTo={redirectTo}
            disabled={loading || isRateLimited}
            onError={setError}
            action="sign in"
          />

          <OAuthDivider />
        </>
      )}

      {!showEmail ? (
        <>
          <button
            type="button"
            onClick={() => setShowEmail(true)}
            className="flex h-10 w-full items-center justify-center rounded-md border border-white/20 px-4 text-sm font-medium text-white transition-colors hover:border-white/30"
          >
            Sign in with email
            {lastProvider === 'email' && <LastUsedBadge />}
          </button>

          {renderFooterLink()}
        </>
      ) : (
        <form
          onSubmit={handleSubmit}
          className={`space-y-4 transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}
        >
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-white/70">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loading || isRateLimited}
              className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-colors placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07] focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="you@example.com"
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium text-white/70">
                Password
              </label>
              <a
                href="/forgot-password"
                className="text-xs text-white/50 transition-colors hover:text-white/80"
              >
                Forgot password?
              </a>
            </div>
            <MaskedInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || isRateLimited}
              className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 pr-10 text-sm text-white transition-colors placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07] focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || isRateLimited || !email || !password}
            className="bg-brand hover:bg-brand/80 mt-4 mb-4 h-10 w-full rounded-md px-4 text-sm font-medium text-black transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? (
              <>
                <Spinner />
                Signing in...
              </>
            ) : isRateLimited ? (
              `Try again in ${rateLimitSeconds}s`
            ) : (
              'Sign in'
            )}
          </button>

          {error && (
            <p
              className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-center text-sm text-red-400"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowEmail(false)}
              className="text-xs font-semibold text-white/50 transition-colors hover:text-white/80"
            >
              &larr; Back to all options
            </button>
            {renderEmailFooterLink()}
          </div>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout showLogomark>
      <Suspense fallback={<AuthFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
