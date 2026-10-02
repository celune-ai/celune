'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@repo/db/client';
import { isRateLimitError, parseRetryAfterSeconds, setLastProvider } from '@/lib/auth-helpers';
import { isPasswordValid, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';
import { Spinner, LastUsedBadge } from '@/components/auth/auth-icons';
import { OAuthButtons, OAuthDivider } from '@/components/auth/oauth-buttons';
import { AuthLayout } from '@/components/auth/auth-layout';
import { URL_MARKETING } from '@/lib/branding';
import { PasswordStrength } from '@/components/password-strength';
import { MaskedInput } from '@/components/masked-input';
import {
  useRateLimit,
  useLastProvider,
  RateLimitBanner,
} from '@/components/auth/auth-form-wrapper';
import { AuthFormSkeleton } from '@/components/auth/auth-form-skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@repo/ui/components/tooltip';

/** When signup is gated, show this access code form instead */
function AccessCodeGate() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || loading) return;
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // Validate the code exists and is available (public check — no auth needed)
      const res = await fetch('/api/access-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid access code.');
        setLoading(false);
        return;
      }

      // Code is valid — redirect to signup with code attached
      setSuccess(`Access code valid! Redirecting to create your account...`);
      setTimeout(() => {
        router.push(`/signup?code=${encodeURIComponent(code.trim().toUpperCase())}`);
      }, 1000);
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Enter Access Code</h1>
        <p className="mt-1 text-sm text-white/50">
          Celune is currently in private access. Enter your code to create an account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="access-code" className="text-sm font-medium text-white/70">
            Access Code
          </label>
          <input
            id="access-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            autoFocus
            disabled={loading}
            maxLength={20}
            className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-center font-mono text-sm tracking-widest text-white uppercase transition-colors placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07] focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="XXXX-XXXX"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="bg-brand hover:bg-brand/80 h-10 w-full rounded-md px-4 text-sm font-medium text-black transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? (
            <>
              <Spinner />
              Validating...
            </>
          ) : (
            'Continue'
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
        {success && (
          <p className="rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2 text-center text-sm text-green-400">
            {success}
          </p>
        )}
      </form>

      <div className="space-y-2 text-center">
        <p className="text-sm text-white/50">
          Already have an account?{' '}
          <a href="/login" className="text-white/80 transition-colors hover:text-white">
            Sign in
          </a>
        </p>
        <p className="text-sm text-white/50">
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
      </div>
    </div>
  );
}

function SignupForm() {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupGated, setSignupGated] = useState(true);
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  const { rateLimitSeconds, isRateLimited, startCountdown } = useRateLimit();
  const lastProvider = useLastProvider();
  const router = useRouter();
  const supabase = createClient();

  // Check if URL has a valid access code (from AccessCodeGate redirect)
  const [hasValidCode, setHasValidCode] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [codeEmail, setCodeEmail] = useState(''); // Pre-fill email from access code

  useEffect(() => {
    // Load flags
    fetch('/api/flags/public')
      .then((r) => r.json())
      .then((flags) => {
        setSignupGated(flags.signup_gated === true);
        setOauthEnabled(flags.oauth_enabled === true);
        setFlagsLoaded(true);
      })
      .catch(() => {
        setSignupGated(true);
        setFlagsLoaded(true);
      });

    // Check for code in URL — server-validate before trusting it
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      fetch('/api/access-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.valid) {
            setAccessCode(code.trim().toUpperCase());
            setHasValidCode(true);
            // Pre-fill email from code and skip straight to email form
            if (data.email) {
              setEmail(data.email);
              setCodeEmail(data.email);
            }
            setShowEmail(true);
          }
          // Invalid code — don't set hasValidCode, gate will show
        })
        .catch(() => {
          // Validation failed — don't trust the code
        });
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isPasswordValid(password)) {
      setError('Password does not meet the requirements below.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);

    const { data: signupData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: accessCode ? { pending_access_code: accessCode } : undefined,
      },
    });

    if (error) {
      const status = (error as { status?: number }).status;
      if (isRateLimitError(error.message, status)) {
        startCountdown(parseRetryAfterSeconds(error.message));
        setError(null);
      } else {
        console.error('[signup] Supabase error:', error.message, error);
        setError(
          error.message || 'Unable to create account. Please check your email and try again.',
        );
      }
      setLoading(false);
      return;
    }

    // Store access code for post-confirmation redemption
    // The auth callback or onboarding flow will pick it up
    if (accessCode) {
      try {
        localStorage.setItem('pending_access_code', accessCode);
      } catch {
        // localStorage unavailable — code stored in user_metadata as fallback
      }

      // If user was auto-confirmed (session exists), redeem immediately
      if (signupData.user && signupData.session) {
        try {
          await fetch('/api/access-codes/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: accessCode }),
          });
          localStorage.removeItem('pending_access_code');
        } catch {
          // Non-fatal — will be redeemed on next login via localStorage
        }
      }
    }

    setLastProvider('email');
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  if (!flagsLoaded) {
    return <AuthFormSkeleton />;
  }

  // If signup is gated and user doesn't have a valid code, show the gate
  if (signupGated && !hasValidCode) {
    return <AccessCodeGate />;
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Create Account</h1>
        <p className="mt-1 text-sm text-white/50">
          {accessCode
            ? 'Your access code is applied. Set up your account.'
            : 'Sign up to get started'}
        </p>
      </div>

      <RateLimitBanner seconds={rateLimitSeconds} />

      {error && (
        <p className="text-center text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {/* Hide OAuth when gated or oauth_enabled flag is off */}
      {!signupGated && oauthEnabled && (
        <>
          <OAuthButtons disabled={loading || isRateLimited} onError={setError} action="sign up" />
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
            Sign up with email
            {lastProvider === 'email' && <LastUsedBadge />}
          </button>

          {!accessCode && (
            <p className="text-center text-sm text-white/50">
              Already have an account?{' '}
              <a href="/login" className="text-white/80 transition-colors hover:text-white">
                Sign in
              </a>
            </p>
          )}
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
            {codeEmail ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      readOnly
                      disabled
                      className="block w-full cursor-not-allowed rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 opacity-70"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>This access code is tied to this email address</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
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
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-white/70">
              Password
            </label>
            <MaskedInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus={!!codeEmail}
              minLength={PASSWORD_MIN_LENGTH}
              disabled={loading || isRateLimited}
              className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 pr-10 text-sm text-white transition-colors placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07] focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={`Min. ${PASSWORD_MIN_LENGTH} characters`}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm-password" className="text-sm font-medium text-white/70">
              Confirm Password
            </label>
            <MaskedInput
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN_LENGTH}
              disabled={loading || isRateLimited}
              className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 pr-10 text-sm text-white transition-colors placeholder:text-white/30 focus:border-white/20 focus:bg-white/[0.07] focus:ring-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="••••••••"
            />
            <div className="mb-6">
              <PasswordStrength password={password} confirmPassword={confirmPassword} />
            </div>
          </div>

          {accessCode && <input type="hidden" name="access_code" value={accessCode} />}

          <button
            type="submit"
            disabled={loading || isRateLimited}
            className="h-10 w-full rounded-md bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading ? (
              <>
                <Spinner />
                Creating account...
              </>
            ) : isRateLimited ? (
              `Try again in ${rateLimitSeconds}s`
            ) : (
              'Create Account'
            )}
          </button>

          {!codeEmail && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowEmail(false)}
                className="text-xs text-white/50 transition-colors hover:text-white/80"
              >
                &larr; Back to all options
              </button>
              <a
                href="/login"
                className="text-xs text-white/50 transition-colors hover:text-white/80"
              >
                Sign in
              </a>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

export default function SignupPage() {
  return (
    <AuthLayout>
      <Suspense fallback={<AuthFormSkeleton />}>
        <SignupForm />
      </Suspense>
    </AuthLayout>
  );
}
