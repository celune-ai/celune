const NANGO_HOST_URL = process.env.NANGO_HOST_URL || 'https://api.nango.dev';
const NANGO_SECRET_KEY = process.env.NANGO_SECRET_KEY || '';

// ---------------------------------------------------------------------------
// Nango API client — fetches OAuth tokens and generates connect URLs
// ---------------------------------------------------------------------------

interface NangoTokenResponse {
  access_token: string;
  expires_at?: string;
}

/**
 * Fetch an OAuth access token from Nango for a given connection.
 */
export async function getNangoToken(connectionId: string, integrationId: string): Promise<string> {
  const url = `${NANGO_HOST_URL}/connection/${connectionId}?provider_config_key=${integrationId}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${NANGO_SECRET_KEY}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[nango] Token fetch failed (${res.status}):`, text);
    throw new Error(`Nango token fetch failed (${res.status})`);
  }

  const data = (await res.json()) as { credentials: NangoTokenResponse };
  return data.credentials.access_token;
}

/**
 * Generate a Nango OAuth connect URL that redirects the user to authorize.
 */
export function createNangoConnection(
  integrationId: string,
  connectionId: string,
  metadata: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    provider_config_key: integrationId,
    connection_id: connectionId,
    ...metadata,
  });

  return `${NANGO_HOST_URL}/oauth/connect?${params.toString()}`;
}
