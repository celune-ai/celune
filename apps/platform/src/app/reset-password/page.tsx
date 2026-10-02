'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@repo/db/client';
import { isPasswordValid, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';
import { isRateLimitError, parseRetryAfterSeconds } from '@/lib/auth-helpers';
import { Spinner } from '@/components/auth/auth-icons';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordStrength } from '@/components/password-strength';
import { MaskedInput } from '@/components/masked-input';

type PageState = 'loading' | 'ready' | 'error' | 'success';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
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

  useEffect(() => {
    async function verifySession() {
      const tokenHash = searchParams.get('token_hash');
      const type = searchParams.get('type');

      if (tokenHash && type === 'recovery') {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });

        if (error) {
          setError('This reset link is invalid or has expired. Please request a new one.');
          setPageState('error');
          return;
        }

        setPageState('ready');
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        setPageState('ready');
        return;
      }

      setError('No valid session found. Please request a new password reset link.');
      setPageState('error');
    }

    verifySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isPasswordValid(password)) {
      setError('Password does not meet the requirements below.');
      return;
    }
    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      const status = (error as { status?: number }).status;
      if (isRateLimitError(error.message, status)) {
        startCountdown(parseRetryAfterSeconds(error.message));
        setError(null);
      } else {
        const lower = error.message.toLowerCase();
        if (lower.includes('same password') || lower.includes('different from')) {
          setError('Your new password must be different from your current password.');
        } else {
          setError('Unable to update password. Please try again.');
        }
      }
      setSubmitting(false);
      return;
    }

    setPageState('success');
    setTimeout(() => {
      router.push('/login?message=password-updated');
    }, 2000);
  }

  if (pageState === 'loading') {
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Verifying reset link...
        </h1>
        <p className="text-sm text-white/50">
          Please wait while we verify your password reset link.
        </p>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Reset link expired</h1>
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
        <a
          href="/forgot-password"
          className="inline-block text-sm text-white/80 transition-colors hover:text-white"
        >
          Request a new reset link
        </a>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Password updated</h1>
        <p className="text-sm text-white/50">Redirecting you to sign in...</p>
      </div>
    );
  }

  const isRateLimited = rateLimitSeconds > 0;

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Reset password</h1>
        <p className="mt-1 text-sm text-white/50">Enter your new password below</p>
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
        className={`space-y-4 transition-opacity duration-200 ${submitting ? 'opacity-60' : 'opacity-100'}`}
      >
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-white/70">
            New password
          </label>
          <MaskedInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
            minLength={PASSWORD_MIN_LENGTH}
            disabled={submitting || isRateLimited}
            className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 pr-10 text-sm text-white transition-colors placeholder:text-white/30 focus:border-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={`Min. ${PASSWORD_MIN_LENGTH} characters`}
          />
          <PasswordStrength password={password} />
        </div>

        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || isRateLimited}
          className="h-10 w-full rounded-md bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Spinner />
              Updating...
            </>
          ) : (
            'Update password'
          )}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
