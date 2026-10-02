import http from 'node:http';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import open from 'open';

export interface AuthResult {
  apiKey: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  email: string;
}

export interface AuthConfig {
  apiUrl: string;
  clientId?: string;
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start the browser-based authentication flow.
 *
 * 1. Spins up a temporary localhost HTTP server on a random port.
 * 2. Opens the admin app's /auth/cli page in the browser with a callback URL.
 * 3. The browser page authenticates the user, creates an API key, and redirects
 *    to the localhost callback with credentials as query params.
 * 4. Returns the received credentials once the callback is hit.
 */
export async function authenticate(config: AuthConfig): Promise<AuthResult> {
  const sessionId = randomUUID();

  return new Promise<AuthResult>((resolve, reject) => {
    let settled = false;

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost`);

      if (url.pathname === '/callback') {
        // Validate session matches the one we issued
        const returnedSession = url.searchParams.get('session');
        if (returnedSession && returnedSession !== sessionId) {
          res.writeHead(403, { 'Content-Type': 'text/html' });
          res.end(
            errorPage('Session mismatch — this callback was not initiated by this CLI instance.'),
          );
          return;
        }

        const apiKey = url.searchParams.get('api_key');
        const workspaceId = url.searchParams.get('workspace_id');
        const workspaceName = url.searchParams.get('workspace_name');
        const userId = url.searchParams.get('user_id');
        const email = url.searchParams.get('email');

        if (apiKey && workspaceId && userId && email) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(successPage());

          settled = true;
          server.close();
          resolve({
            apiKey,
            workspaceId,
            workspaceName: workspaceName ?? '',
            userId,
            email,
          });
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(errorPage('Missing required parameters. Please try again from the CLI.'));
        }
        return;
      }

      // Unknown path
      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to start local auth server'));
        return;
      }

      const port = addr.port;
      const callbackUrl = `http://127.0.0.1:${port}/callback`;
      const authUrl = `${config.apiUrl}/auth/cli?session=${sessionId}&callback=${encodeURIComponent(callbackUrl)}`;

      console.log(chalk.dim('Opening browser for authentication...'));
      console.log(chalk.dim(`If the browser doesn't open, visit:`));
      console.log(chalk.cyan(authUrl));
      console.log();

      open(authUrl).catch(() => {
        // Browser didn't open — user will need to copy URL manually
        console.log(
          chalk.yellow('Could not open browser automatically. Please open the URL above.'),
        );
      });
    });

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Auth server error: ${err.message}`));
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error('Authentication timed out after 5 minutes. Please try again.'));
      }
    }, AUTH_TIMEOUT_MS);
  });
}

/**
 * Revoke the stored token and clean up credentials.
 */
export async function revokeToken(_token: string): Promise<void> {
  throw new Error('Not implemented — Sprint 3');
}

// ---- HTML pages returned to the browser ----

function successPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Connected — Celune CLI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 400px; padding: 2rem; }
    h1 { color: #5BC586; font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #a3a3a3; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connected!</h1>
    <p>You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorPage(message: string): string {
  const escaped = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Error — Celune CLI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 400px; padding: 2rem; }
    h1 { color: #ef4444; font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #a3a3a3; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Something went wrong</h1>
    <p>${escaped}</p>
  </div>
</body>
</html>`;
}
