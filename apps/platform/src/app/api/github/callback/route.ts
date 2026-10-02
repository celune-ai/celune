/**
 * GitHub App OAuth callback handler.
 *
 * GitHub redirects here after a user installs the GitHub App:
 *   GET /api/github/callback?installation_id=<id>&state=<hmac-signed>
 *
 * This route:
 * 1. Verifies HMAC-signed state (workspace ID + timestamp)
 * 2. Fetches GitHub account metadata for the installation
 * 3. Registers the installation at the ORG level (org_github_installations)
 * 4. Sets installation_id on the REQUESTING workspace only (no sibling propagation)
 * 5. Returns a self-closing HTML page
 *
 * POST /api/github/callback — complete repo selection after the user picks a repo.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@repo/db/service';
import { getSessionUserId } from '@repo/db/middleware';
import { requireWorkspaceMembership } from '@/lib/require-workspace';
import { safeErrorResponse } from '@/lib/api-error';
import {
  listInstallationRepos,
  parseGitHubOAuthState,
  createAppOctokit,
  isGitHubAppConfigured,
  GitHubAppNotConfiguredError,
  type GitHubRepo,
} from '@/lib/github-app';
import { registerOrgInstallation, verifyOrgInstallation } from '@/lib/github-org';
import { validateOrigin } from '@/lib/csrf';
import { githubCallbackPostSchema } from '@/lib/schemas/github.schema';
import { seedIntegrationMemories, reactivateIntegrationMemories } from '@/lib/seed-knowledge-packs';

import { applyRateLimit, RATE_AUTH } from '@/lib/rate-limiter';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Auth from cookies directly — this route is a browser redirect from GitHub,
    // not a fetch() call, so the proxy middleware doesn't inject x-user-id.
    const userId = await getSessionUserId(request);
    if (!userId) {
      return respondWithHtml(
        'Session Expired',
        'Please log in again and retry the GitHub connection.',
        true,
      );
    }

    const { searchParams } = new URL(request.url);
    const installationId = searchParams.get('installation_id');
    const stateParam = searchParams.get('state');

    if (!installationId && !stateParam) {
      return respondWithHtml(
        'Connection Cancelled',
        'The GitHub connection was cancelled. You can try again from your settings.',
        true,
      );
    }

    // GitHub sometimes sends installation_id without state (new installs, setup_action flows).
    // If we have an installation_id but no state, register it at the org level using the session.
    if (installationId && !stateParam) {
      const installationIdNum = parseInt(installationId, 10);
      if (!isNaN(installationIdNum)) {
        try {
          const supabase = createServiceClient();

          // Find user's org
          const { data: membership } = await supabase
            .from('org_memberships')
            .select('org_id')
            .eq('user_id', userId)
            .limit(1)
            .single();

          const orgId = membership?.org_id;
          if (orgId) {
            // Fetch account metadata from GitHub
            let accountLogin = 'pending-sync';
            let accountAvatarUrl: string | null = null;
            let accountType: 'Organization' | 'User' = 'Organization';
            try {
              if (isGitHubAppConfigured()) {
                const appOctokit = createAppOctokit();
                const {
                  data: { account },
                } = await appOctokit.rest.apps.getInstallation({
                  installation_id: installationIdNum,
                });
                if (account) {
                  accountLogin = ('login' in account ? account.login : account.name) ?? 'unknown';
                  accountAvatarUrl = account.avatar_url ?? null;
                  accountType =
                    'type' in account && account.type === 'Organization' ? 'Organization' : 'User';
                }
              }
            } catch {
              // Will be populated on next sync
            }

            await registerOrgInstallation(
              supabase,
              orgId,
              installationIdNum,
              accountLogin,
              accountAvatarUrl,
              accountType,
              userId,
            );
          }
        } catch (err) {
          console.error('[github/callback] Failed to register stateless installation:', err);
        }
      }

      return respondWithHtml(
        'GitHub Connected',
        'New GitHub account connected. Returning to Celune.',
        false,
      );
    }

    // --- Verify HMAC-signed state (includes userId for defense-in-depth) ---
    if (!stateParam || !installationId) {
      return respondWithHtml(
        'Connection Error',
        'Missing required parameters. Please retry the GitHub connection.',
        true,
      );
    }
    const parsed = parseGitHubOAuthState(stateParam, userId);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid or expired state parameter. Please retry the GitHub connection.' },
        { status: 403 },
      );
    }

    const { workspaceId } = parsed;

    // Verify the user is a member of the target workspace (not just the org)
    const membershipError = await requireWorkspaceMembership(userId, workspaceId);
    if (membershipError) {
      return respondWithHtml(
        'Access Denied',
        'You do not have access to this workspace. Contact the workspace owner.',
        true,
      );
    }

    const installationIdNum = parseInt(installationId, 10);
    if (isNaN(installationIdNum)) {
      return NextResponse.json({ error: 'installation_id must be a number' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Resolve org from workspace directly (org_members may not be populated during onboarding)
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id')
      .eq('id', workspaceId)
      .single();

    if (!workspace?.org_id) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const orgId = workspace.org_id;

    // Fetch GitHub account metadata for this installation
    let accountLogin = 'pending-sync';
    let accountAvatarUrl: string | null = null;
    let accountType: 'Organization' | 'User' = 'Organization';

    try {
      if (isGitHubAppConfigured()) {
        const appOctokit = createAppOctokit();
        const {
          data: { account },
        } = await appOctokit.rest.apps.getInstallation({
          installation_id: installationIdNum,
        });
        if (account) {
          accountLogin = ('login' in account ? account.login : account.name) ?? 'unknown';
          accountAvatarUrl = account.avatar_url ?? null;
          accountType =
            'type' in account && account.type === 'Organization' ? 'Organization' : 'User';
        }
      }
    } catch (ghErr) {
      const ghMessage = ghErr instanceof Error ? ghErr.message : String(ghErr);
      console.error('[github/callback] Failed to fetch installation account info:', ghMessage);
    }

    // Register installation at org level
    const registered = await registerOrgInstallation(
      supabase,
      orgId,
      installationIdNum,
      accountLogin,
      accountAvatarUrl,
      accountType,
      userId,
    );

    if (!registered) {
      // Concurrent insert for same org+installation; verify it exists
      const existing = await verifyOrgInstallation(supabase, orgId, installationIdNum);
      if (!existing) {
        return respondWithHtml(
          'Connection Failed',
          'Unable to register this GitHub installation. Please try again.',
          true,
        );
      }
    }

    // Set installation on the requesting workspace ONLY (no sibling propagation)
    const { error: wsUpdateErr } = await supabase
      .from('workspaces')
      .update({ github_installation_id: installationIdNum })
      .eq('id', workspaceId);
    // Verify repos are accessible (for the success message)
    let repoCount = 0;
    try {
      const repos = await listInstallationRepos(installationIdNum);
      repoCount = repos.length;
    } catch {
      // Non-fatal — user can still select repos later
    }

    const safeLogin = escapeHtml(accountLogin);
    return respondWithClosingPage(safeLogin, repoCount);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/**
 * POST /api/github/callback — complete the repo selection after the user picks
 * a repo from the list returned by GET.
 *
 * Body: { workspace_id, repo_url, repo_path?, installation_id?, default_branch? }
 */
export async function POST(request: NextRequest) {
  const rateLimitResult = await applyRateLimit(request, 'github.callback.post', RATE_AUTH);
  if (rateLimitResult) return rateLimitResult.blocked;

  try {
    const originError = await validateOrigin(request);
    if (originError) return originError;

    // Try proxy-injected header first, fall back to cookie session
    const userId = request.headers.get('x-user-id') || (await getSessionUserId(request));
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = createServiceClient();

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const bodyParsed = githubCallbackPostSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json(
        { error: bodyParsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { workspace_id, repo_url, repo_path, installation_id, default_branch } = bodyParsed.data;

    // Resolve org from workspace directly (org_members may not be populated during onboarding)
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, org_id, github_installation_id')
      .eq('id', workspace_id)
      .single();

    if (!workspace?.org_id) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const postOrgId = workspace.org_id;

    // If an installation_id is provided, verify it belongs to this org
    const effectiveInstallationId = installation_id ?? workspace.github_installation_id;
    if (effectiveInstallationId) {
      const verified = await verifyOrgInstallation(supabase, postOrgId, effectiveInstallationId);
      if (!verified) {
        return NextResponse.json(
          { error: 'Installation not registered for this organization' },
          { status: 403 },
        );
      }
    }

    const { data: updated, error } = await supabase
      .from('workspaces')
      .update({
        repo_url: repo_url.trim(),
        repo_provider: 'github',
        repo_path: (repo_path ?? '/').trim() || '/',
        repo_connected_at: new Date().toISOString(),
        github_installation_id: effectiveInstallationId,
        github_default_branch: default_branch ?? 'main',
      })
      .eq('id', workspace_id)
      .select(
        'id, name, slug, repo_url, repo_provider, repo_path, repo_connected_at, github_installation_id, github_default_branch',
      )
      .single();

    if (error) return safeErrorResponse(error);

    // Reactivate any previously deactivated GitHub memories, then seed new ones
    const seedCtx = { userId, orgId: postOrgId, workspaceId: workspace_id };
    void reactivateIntegrationMemories(workspace_id, 'github')
      .then(() => seedIntegrationMemories(seedCtx, 'github'))
      .catch((err) => {
        console.error('[github/callback] github memories seed failed:', err);
      });

    return NextResponse.json(updated);
  } catch (error) {
    return safeErrorResponse(error);
  }
}

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build an HTML response page. Non-error pages attempt to notify opener and close. */
function respondWithHtml(title: string, message: string, isError: boolean) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const color = isError ? '#ef4444' : '#fafafa';
  // Non-error pages (e.g., "already installed") notify the opener to re-detect
  const script = isError
    ? ''
    : `<script>
try {
  if (window.opener) {
    window.opener.postMessage({ type: 'github-recheck' }, window.location.origin);
  }
} catch (e) {}
window.close();
setTimeout(function() {
  document.querySelector('#msg').textContent = 'You can close this tab.';
}, 500);
</script>`;
  const html = `<!DOCTYPE html>
<html><head><title>${safeTitle}</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:${color}">
<div style="text-align:center;max-width:400px;padding:0 20px">
<p style="font-size:18px;font-weight:500">${safeTitle}</p>
<p id="msg" style="color:#888;font-size:14px;margin-top:8px">${safeMessage}</p>
</div>
${script}
</body></html>`;
  return new NextResponse(html, {
    status: isError ? 403 : 200,
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Build a page that notifies the opener via postMessage and closes itself */
function respondWithClosingPage(accountLogin: string, repoCount: number) {
  const html = `<!DOCTYPE html>
<html><head><title>GitHub Connected</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa">
<div style="text-align:center;max-width:400px;padding:0 20px">
<p style="color:#888;font-size:14px">Closing&hellip;</p>
</div>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({
      type: 'github-connected',
      accountLogin: ${JSON.stringify(accountLogin)},
      repoCount: ${repoCount}
    }, window.location.origin);
  }
} catch (e) {}
window.close();
// Fallback if window.close() is blocked
setTimeout(function() {
  document.body.textContent = '';
  var d = document.createElement('div');
  d.style.cssText = 'font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#fafafa';
  var inner = document.createElement('div');
  inner.style.textAlign = 'center';
  var t = document.createElement('p');
  t.style.cssText = 'font-size:18px;font-weight:500';
  t.textContent = 'GitHub Connected';
  var s = document.createElement('p');
  s.style.cssText = 'color:#888;font-size:14px;margin-top:8px';
  s.textContent = 'You can close this tab.';
  inner.appendChild(t);
  inner.appendChild(s);
  d.appendChild(inner);
  document.body.appendChild(d);
}, 500);
</script>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
