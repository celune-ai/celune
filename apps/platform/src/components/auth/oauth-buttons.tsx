'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@repo/db/client';
import { getLastProvider, setLastProvider } from '@/lib/auth-helpers';
import { Spinner, LastUsedBadge, GitHubIcon, GoogleIcon } from './auth-icons';

type OAuthProvider = 'github' | 'google';

const PROVIDER_CONFIG: Record<OAuthProvider, { icon: typeof GitHubIcon; label: string }> = {
  github: { icon: GitHubIcon, label: 'GitHub' },
  google: { icon: GoogleIcon, label: 'Google' },
};

/** Comma-separated list: "github,google". Defaults to all if unset. */
const enabledProviders: OAuthProvider[] = (() => {
  const raw = process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
  if (!raw) return ['github', 'google'];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is OAuthProvider => s in PROVIDER_CONFIG);
})();

interface OAuthButtonsProps {
  redirectTo?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
  /** "sign in" or "sign up" — used in error messages */
  action?: 'sign in' | 'sign up';
}

export function OAuthButtons({
  redirectTo = '/',
  disabled = false,
  onError,
  action = 'sign in',
}: OAuthButtonsProps) {
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [lastProvider, setLastProviderState] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    setLastProviderState(getLastProvider());
  }, []);

  async function handleOAuth(provider: OAuthProvider) {
    setOauthLoading(provider);
    setLastProvider(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback${redirectTo !== '/' ? `?next=${encodeURIComponent(redirectTo)}` : ''}`,
      },
    });
    if (error) {
      onError?.(`Failed to ${action} with ${provider}. Please try again.`);
      setOauthLoading(null);
    }
  }

  if (enabledProviders.length === 0) return null;

  const isLoading = oauthLoading !== null;

  return (
    <div className="space-y-3">
      {enabledProviders.map((provider) => {
        const { icon: Icon, label } = PROVIDER_CONFIG[provider];
        return (
          <button
            key={provider}
            type="button"
            onClick={() => handleOAuth(provider)}
            disabled={disabled || isLoading}
            className="flex h-10 w-full items-center justify-center gap-3 rounded-md border border-white/20 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
          >
            {oauthLoading === provider ? <Spinner /> : <Icon />}
            Continue with {label}
            {lastProvider === provider && <LastUsedBadge />}
          </button>
        );
      })}
    </div>
  );
}

export function OAuthDivider() {
  if (enabledProviders.length === 0) return null;

  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-white/20" />
      <span className="text-xs text-white/50">or</span>
      <div className="h-px flex-1 bg-white/20" />
    </div>
  );
}
