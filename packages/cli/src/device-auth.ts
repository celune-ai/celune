import chalk from 'chalk';
import ora from 'ora';
import open from 'open';

export interface DeviceAuthResult {
  apiKey: string;
  workspaceId: string;
  workspaceName: string;
  userId: string;
  email: string;
}

export interface DeviceAuthConfig {
  apiUrl: string;
  /** Skip auto-opening the browser (user is already on the page). */
  skipBrowser?: boolean;
}

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 minutes (matches server expiry)

/**
 * Device Authorization Flow (RFC 8628-style).
 *
 * 1. Requests a device_code + user_code from the server.
 * 2. Displays the user_code prominently for the user to enter in their browser.
 * 3. Optionally opens the browser to the verification page.
 * 4. Polls for authorization, then receives API key.
 */
export async function deviceAuth(config: DeviceAuthConfig): Promise<DeviceAuthResult> {
  // Step 1: Request device code
  const codeSpinner = ora('Requesting authorization code...').start();

  const codeRes = await fetch(`${config.apiUrl}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!codeRes.ok) {
    codeSpinner.fail('Failed to start device authorization');
    const body = (await codeRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${codeRes.status}`);
  }

  const {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
  } = (await codeRes.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  codeSpinner.succeed('Authorization code ready');

  // Step 2: Display the code prominently — this is the hero output
  console.log();
  console.log(chalk.bgGreen.black.bold(` ${userCode} `));
  console.log();
  console.log(chalk.dim('  Enter this code in your Celune dashboard or at:'));
  console.log(chalk.cyan(`  ${verificationUri}`));
  console.log();

  // Only open browser for standalone `celune auth`, not during `celune setup`
  // (user is likely already on the onboarding page during setup)
  if (!config.skipBrowser) {
    open(verificationUri).catch(() => {
      // Silent — URL is already printed above
    });
  }

  // Step 3: Poll for authorization
  const pollSpinner = ora('Waiting for you to enter the code in your browser...').start();
  const deadline = Date.now() + MAX_POLL_DURATION_MS;

  return new Promise<DeviceAuthResult>((resolve, reject) => {
    async function poll() {
      if (Date.now() > deadline) {
        pollSpinner.fail('Authorization timed out');
        reject(new Error('Authorization timed out. Please try again.'));
        return;
      }

      try {
        const res = await fetch(`${config.apiUrl}/api/auth/device/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_code: deviceCode }),
        });

        if (res.status === 428) {
          // authorization_pending — keep polling
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        if (res.status === 410) {
          pollSpinner.fail('Authorization expired');
          reject(new Error('Authorization expired. Please try again.'));
          return;
        }

        if (res.status === 409) {
          pollSpinner.fail('Code already used');
          reject(new Error('This code has already been used. Please try again.'));
          return;
        }

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          pollSpinner.fail('Authorization failed');
          reject(new Error(body.error || `HTTP ${res.status}`));
          return;
        }

        const data = (await res.json()) as {
          api_key: string;
          workspace_id: string;
          workspace_name: string;
          user_id: string;
          email: string;
        };

        pollSpinner.succeed(`Authorized as ${data.email}`);
        resolve({
          apiKey: data.api_key,
          workspaceId: data.workspace_id,
          workspaceName: data.workspace_name,
          userId: data.user_id,
          email: data.email,
        });
      } catch {
        // Network error — retry
        setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    setTimeout(poll, POLL_INTERVAL_MS);
  });
}
