'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@repo/db/client';
import { AuthLayout } from '@/components/auth/auth-layout';

const RESEND_COOLDOWN_SECONDS = 60;

function MailIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-white/60"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email');
  const supabase = createClient();

  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResend = useCallback(async () => {
    if (!emailParam || resendCooldown > 0) return;
    setResendStatus('sending');

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: emailParam,
    });

    if (error) {
      setResendStatus('error');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setResendStatus('sent');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }, [emailParam, resendCooldown, supabase.auth]);

  return (
    <div className="w-full max-w-sm space-y-8 text-center">
      <div className="flex justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <MailIcon />
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Check your email</h1>
        {emailParam ? (
          <p className="text-sm text-white/70">
            We sent a confirmation link to <span className="text-white/80">{emailParam}</span>.
            Didn&apos;t receive it? Check your spam folder or resend the email.
          </p>
        ) : (
          <p className="text-sm text-white/70">
            We sent a confirmation link to your email address. Didn&apos;t receive it? Check your
            spam folder or resend the email.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {emailParam && (
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0 || resendStatus === 'sending'}
            className="h-10 w-full rounded-md border border-white/20 px-4 text-sm font-medium text-white transition-colors hover:border-white/30 disabled:pointer-events-none disabled:opacity-50"
          >
            {resendStatus === 'sending'
              ? 'Sending...'
              : resendCooldown > 0
                ? `Resend email (${resendCooldown}s)`
                : 'Resend email'}
          </button>
        )}

        <div aria-live="polite">
          {resendStatus === 'sent' && (
            <p className="text-sm text-white/70">
              This email already has a pending signup.{' '}
              <a
                href="/login"
                className="text-white/80 underline transition-colors hover:text-white"
              >
                Try signing in
              </a>{' '}
              — your account may already be verified.
            </p>
          )}
          {resendStatus === 'error' && (
            <p className="text-xs text-red-400">
              Too many requests.{' '}
              {resendCooldown > 0 ? `Try again in ${resendCooldown}s.` : 'Please try again.'}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <a href="/signup" className="text-sm text-white/70 transition-colors hover:text-white/80">
          Try a different email
        </a>
        <a href="/login" className="text-sm text-white/70 transition-colors hover:text-white/80">
          Back to sign in
        </a>
      </div>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <AuthLayout>
      <Suspense>
        <CheckEmailContent />
      </Suspense>
    </AuthLayout>
  );
}
