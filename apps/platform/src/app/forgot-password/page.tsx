'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { createClient } from '@repo/db/client';
import { isRateLimitError, parseRetryAfterSeconds } from '@/lib/auth-helpers';
import { AuthLayout } from '@/components/auth/auth-layout';

function Spinner() {
  return (
    <svg
      className="mr-2 inline-block h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase = createClient();

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function startCountdown(seconds: number) {
    setRateLimitSeconds(seconds);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRateLimitSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      const status = (error as { status?: number }).status;
      if (isRateLimitError(error.message, status)) {
        startCountdown(parseRetryAfterSeconds(error.message));
        setError(null);
      } else {
        setError('Unable to process request. Please try again.');
      }
      setLoading(false);
      return;
    }

    setSubmitted(true);
    setLoading(false);
  }

  const isRateLimited = rateLimitSeconds > 0;

  if (submitted) {
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Check your email</h1>
          <p className="mt-2 text-sm text-white/50">
            We sent a password reset link to <span className="text-white/80">{email}</span>
          </p>
        </div>
        <a
          href="/login"
          className="block text-sm text-white/50 transition-colors hover:text-white/80"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Forgot password?</h1>
        <p className="mt-1 text-sm text-white/50">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>

      {isRateLimited && (
        <p
          className="rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-center text-sm text-yellow-400"
          role="alert"
        >
          Too many attempts. Please try again in {rateLimitSeconds} second
          {rateLimitSeconds !== 1 ? 's' : ''}.
        </p>
      )}

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

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || isRateLimited}
          className="h-10 w-full rounded-md bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? (
            <>
              <Spinner />
              Sending...
            </>
          ) : isRateLimited ? (
            `Try again in ${rateLimitSeconds}s`
          ) : (
            'Send reset link'
          )}
        </button>
      </form>

      <p className="text-center text-sm text-white/50">
        <a href="/login" className="text-white/80 transition-colors hover:text-white">
          Back to sign in
        </a>
      </p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
