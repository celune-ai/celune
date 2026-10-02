import { NextResponse } from 'next/server';
import { URL_APP } from '@/lib/branding';

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? URL_APP;
  return NextResponse.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: null, // API key auth — no dynamic client registration
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write', 'admin'],
  });
}
