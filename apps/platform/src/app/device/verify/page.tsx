'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import { createClient } from '@repo/db/client';
import { AuthLayout } from '@/components/auth/auth-layout';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

function DeviceVerifyForm() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [userCode, setUserCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const supabase = createClient();

  const loadUser = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        // No user — show inline sign-in (don't redirect)
        setLoading(false);
        return;
      }

      setUser(currentUser);

      const { data } = await supabase
        .from('workspace_memberships')
        .select('workspace_id, workspaces(id, name, slug)')
        .eq('user_id', currentUser.id);

      const ws: Workspace[] = (data ?? [])
        .map((d) => {
          const w = d.workspaces as unknown as Workspace | null;
          return w ? { id: w.id, name: w.name, slug: w.slug } : null;
        })
        .filter((w): w is Workspace => w !== null);

      setWorkspaces(ws);
      if (ws.length === 1) {
        setSelectedWorkspace(ws[0].id);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for auth state changes (e.g. after OAuth sign-in)
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        loadUser();
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCodeChange(value: string) {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length <= 8) {
      setUserCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
    }
  }

  async function handleVerify() {
    if (!selectedWorkspace || userCode.replace('-', '').length !== 8) return;

    setVerifying(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_code: userCode,
          workspace_id: selectedWorkspace,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Verification failed (${res.status})`);
        setVerifying(false);
        return;
      }

      setVerified(true);
    } catch {
      setError('Failed to connect. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleEmailSignIn() {
    setSigningIn(true);
    setError(null);
    // Redirect to login with return URL — after login they'll come right back
    window.location.href = `/login?redirectTo=${encodeURIComponent('/device/verify')}`;
  }

  async function handleOAuthSignIn(provider: 'github' | 'google') {
    setSigningIn(true);
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/device/verify')}`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
          <p className="text-sm text-white/50">Loading...</p>
        </div>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
          <svg
            className="h-8 w-8 text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-white">Device Authorized</h1>
          <p className="text-sm text-white/50">
            Your CLI is now connected. Return to your terminal to finish setup.
          </p>
        </div>
        <p className="text-xs text-white/30">You can close this tab.</p>
      </div>
    );
  }

  // Not signed in — show inline auth options + code input
  if (!user) {
    return (
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-bold text-white">Authorize Device</h1>
          <p className="text-sm text-white/50">
            Sign in to connect your CLI to your Celune workspace.
          </p>
        </div>

        {error && (
          <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-center text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => handleOAuthSignIn('github')}
            disabled={signingIn}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Continue with GitHub
          </button>

          <button
            type="button"
            onClick={() => handleOAuthSignIn('google')}
            disabled={signingIn}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <div className="relative my-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-black px-2 text-white/30">or</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleEmailSignIn}
            disabled={signingIn}
            className="flex h-10 w-full items-center justify-center rounded-md border border-white/10 bg-white/5 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
          >
            Sign in with email
          </button>
        </div>

        <p className="text-center text-xs text-white/30">
          After signing in, you&apos;ll enter the code from your terminal.
        </p>
      </div>
    );
  }

  // Signed in — show code input + workspace picker
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-bold text-white">Authorize Device</h1>
        <p className="text-sm text-white/50">
          Enter the code shown in your terminal to connect your CLI.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-center text-sm text-red-400">
          {error}
        </p>
      )}

      {user && <p className="text-center text-xs text-white/40">Signed in as {user.email}</p>}

      <div className="space-y-4">
        {/* Code input */}
        <div className="space-y-2">
          <label htmlFor="device-code" className="text-sm font-medium text-white/70">
            Device Code
          </label>
          <input
            id="device-code"
            type="text"
            value={userCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoFocus
            className="block w-full rounded-md border border-white/10 bg-white/5 px-4 py-3 text-center font-mono text-lg tracking-[0.25em] text-white transition-colors placeholder:text-white/20 focus:border-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none"
          />
        </div>

        {/* Workspace selector */}
        {workspaces.length > 1 && (
          <div className="space-y-2">
            <label htmlFor="workspace" className="text-sm font-medium text-white/70">
              Workspace
            </label>
            <select
              id="workspace"
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              disabled={verifying}
              className="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-colors focus:border-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled className="bg-neutral-900 text-white/50">
                Select a workspace...
              </option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id} className="bg-neutral-900 text-white">
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={handleVerify}
          disabled={!selectedWorkspace || userCode.replace('-', '').length !== 8 || verifying}
          className="flex h-10 w-full items-center justify-center rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {verifying ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />
              Verifying...
            </span>
          ) : (
            'Authorize'
          )}
        </button>
      </div>

      <p className="text-center text-xs text-white/30">
        This will create an API key for the selected workspace and connect it to your CLI.
      </p>
    </div>
  );
}

export default function DeviceVerifyPage() {
  return (
    <AuthLayout>
      <Suspense
        fallback={
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            <p className="text-sm text-white/50">Loading...</p>
          </div>
        }
      >
        <DeviceVerifyForm />
      </Suspense>
    </AuthLayout>
  );
}
