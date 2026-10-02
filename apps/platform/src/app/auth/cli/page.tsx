'use client';

import { useSearchParams } from 'next/navigation';
import { useState, useEffect, Suspense, useCallback } from 'react';
import { createClient } from '@repo/db/client';
import { AuthLayout } from '@/components/auth/auth-layout';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

function CliAuthForm() {
  const searchParams = useSearchParams();
  const session = searchParams.get('session');
  const callback = searchParams.get('callback');

  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser) {
        // Redirect to login with return URL back to this page
        const returnUrl = `/auth/cli?session=${session ?? ''}&callback=${encodeURIComponent(callback ?? '')}`;
        window.location.href = `/login?redirectTo=${encodeURIComponent(returnUrl)}`;
        return;
      }

      setUser(currentUser);

      // Fetch workspaces this user belongs to
      const { data, error: fetchError } = await supabase
        .from('workspace_memberships')
        .select('workspace_id, workspaces(id, name, slug)')
        .eq('user_id', currentUser.id);

      if (fetchError) {
        setError('Failed to load workspaces.');
        setLoading(false);
        return;
      }

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
  }, [supabase, session, callback]);

  useEffect(() => {
    loadWorkspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    if (!selectedWorkspace || !callback) return;

    // Validate callback is localhost to prevent open redirect + credential theft
    try {
      const callbackUrl = new URL(callback);
      if (callbackUrl.hostname !== '127.0.0.1' || callbackUrl.protocol !== 'http:') {
        setError('Invalid callback URL — must be a local CLI server.');
        return;
      }
    } catch {
      setError('Invalid callback URL format.');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      // Create an API key via the existing API
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: selectedWorkspace,
          name: `CLI (${new Date().toLocaleDateString()})`,
          scopes: ['write'],
          environment: 'live',
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to create API key (${res.status})`);
        setConnecting(false);
        return;
      }

      const data = await res.json();
      const apiKey = data.plaintext_key;

      if (!apiKey) {
        setError('Failed to retrieve API key. Please try again.');
        setConnecting(false);
        return;
      }

      const workspace = workspaces.find((w) => w.id === selectedWorkspace);

      // Build callback URL with credentials
      const params = new URLSearchParams({
        api_key: apiKey,
        workspace_id: selectedWorkspace,
        workspace_name: workspace?.name ?? '',
        user_id: user?.id ?? '',
        email: user?.email ?? '',
      });

      // Redirect browser to the CLI's localhost callback
      window.location.href = `${callback}?${params.toString()}`;
    } catch {
      setError('Failed to connect. Please try again.');
      setConnecting(false);
    }
  }

  if (!session || !callback) {
    return (
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-bold text-white">Invalid Request</h1>
        <p className="text-sm text-white/50">
          This page should be opened from the Celune CLI. Run{' '}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">celune setup</code> to get
          started.
        </p>
      </div>
    );
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

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-bold text-white">Connect Celune CLI</h1>
        <p className="text-sm text-white/50">Select a workspace to connect your CLI tools to.</p>
      </div>

      {error && (
        <p className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-center text-sm text-red-400">
          {error}
        </p>
      )}

      {user && <p className="text-center text-xs text-white/40">Signed in as {user.email}</p>}

      {workspaces.length === 0 ? (
        <div className="rounded-md border border-white/10 bg-white/5 p-4 text-center">
          <p className="text-sm text-white/70">No workspaces found.</p>
          <p className="mt-1 text-xs text-white/40">Create a workspace in the dashboard first.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label htmlFor="workspace" className="text-sm font-medium text-white/70">
              Workspace
            </label>
            <select
              id="workspace"
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              disabled={connecting}
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

          <button
            type="button"
            onClick={handleConnect}
            disabled={!selectedWorkspace || connecting}
            className="flex h-10 w-full items-center justify-center rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {connecting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black/70" />
                Connecting...
              </span>
            ) : (
              'Connect'
            )}
          </button>
        </>
      )}

      <p className="text-center text-xs text-white/30">
        This will create an API key for the selected workspace.
      </p>
    </div>
  );
}

export default function CliAuthPage() {
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
        <CliAuthForm />
      </Suspense>
    </AuthLayout>
  );
}
