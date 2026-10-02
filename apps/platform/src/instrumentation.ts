export async function register() {
  // Startup validation for critical env vars (production only, server runtime)
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_RUNTIME === 'nodejs') {
    validateProductionEnv();
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fails the boot on a host JWT secret shorter than 32 bytes.
    const { jwtConfigFromEnv } = await import('@celuneai/api');
    jwtConfigFromEnv(process.env);

    const { hostConfig } = await import('@/lib/host-config');
    console.info(`[startup] edition=${hostConfig.edition} gate=${hostConfig.gateMode}`);
  }

  if (process.env.SENTRY_AUTH_TOKEN) {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      await import('../sentry.server.config');
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
      await import('../sentry.edge.config');
    }
  }
}

/**
 * Validate critical environment variables at startup.
 * Logs warnings for missing or malformed vars. Does not throw — the app
 * starts but affected features (BYOK, webhooks) will fail at runtime.
 */
function validateProductionEnv() {
  const warnings: string[] = [];

  // BYOK encryption key — required if any provider keys are stored
  const encKey = process.env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!encKey) {
    warnings.push(
      'PROVIDER_KEY_ENCRYPTION_KEY is not set. BYOK provider keys will fail to encrypt/decrypt. Generate with: openssl rand -hex 32',
    );
  } else if (!/^[0-9a-f]{64}$/i.test(encKey)) {
    warnings.push(
      `PROVIDER_KEY_ENCRYPTION_KEY is malformed (expected 64 hex chars, got ${encKey.length}). BYOK operations will fail.`,
    );
  }

  const jobHmacKey = process.env.JOB_HMAC_KEY?.trim();
  if (!jobHmacKey) {
    warnings.push(
      'JOB_HMAC_KEY is not set. Job rows are signed with the legacy PROVIDER_KEY_ENCRYPTION_KEY subkey, which the next release stops accepting. Generate with: openssl rand -hex 32',
    );
  } else if (!/^[0-9a-f]{64}$/i.test(jobHmacKey)) {
    warnings.push(
      `JOB_HMAC_KEY is malformed (expected 64 hex chars, got ${jobHmacKey.length}). Job signing will fail.`,
    );
  }

  // GitHub webhook secret — required for webhook signature verification
  if (!process.env.GITHUB_APP_WEBHOOK_SECRET) {
    warnings.push('GITHUB_APP_WEBHOOK_SECRET is not set. GitHub webhooks will be rejected.');
  }

  for (const warning of warnings) {
    console.warn(`[startup] WARNING: ${warning}`);
  }
}

export async function onRequestError(
  ...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>
) {
  if (process.env.SENTRY_AUTH_TOKEN) {
    const { captureRequestError } = await import('@sentry/nextjs');
    return captureRequestError(...args);
  }
}
