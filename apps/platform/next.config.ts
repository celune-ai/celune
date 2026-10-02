import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

// ---------------------------------------------------------------------------
// Content-Security-Policy (Enforcing)
// ---------------------------------------------------------------------------
// Enforcing mode: violations are blocked. Promoted from report-only in Sprint 4
// after confirming zero false positives during the report-only observation period.
//
// Allowed origins:
//   - 'self'             — same origin
//   - Supabase           — DB, Auth, Storage, Realtime
//   - Sentry             — error reporting (*.sentry.io, *.ingest.sentry.io)
//   - ElevenLabs         — voice TTS (api.elevenlabs.io)
//   - 'unsafe-inline'    — required for Tailwind v4 style injection
//   - blob:              — for generated audio/media URLs
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://*.supabase.co';
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' *.sentry.io static.cloudflareinsights.com`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${supabaseUrl} *.supabase.co lh3.googleusercontent.com avatars.githubusercontent.com`,
  `font-src 'self' data:`,
  `connect-src 'self' ${supabaseUrl} *.supabase.co wss://*.supabase.co *.sentry.io *.ingest.sentry.io api.elevenlabs.io api.anthropic.com api.openai.com api.nango.dev connect.nango.dev cloudflareinsights.com`,
  `media-src 'self' blob: ${supabaseUrl} api.elevenlabs.io`,
  `frame-src 'self' connect.nango.dev`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `worker-src 'self' blob:`,
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: cspDirectives,
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: [
    '@repo/ui',
    '@repo/types',
    '@repo/db',
    '@repo/notifications',
    '@repo/agentmail',
  ],
  serverExternalPackages: ['better-sqlite3', 'agentmail'],
  turbopack: {
    resolveAlias: {
      // Explicit barrel export resolution for Turbopack
      './tools/memory': './tools/memory/index',
      './tools/tasks': './tools/tasks/index',
      './tools/projects': './tools/projects/index',
      './tools/onboarding': './tools/onboarding/index',
      './tools/workspace': './tools/workspace/index',
      './tools/jobs': './tools/jobs/index',
    },
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', '@repo/ui', 'date-fns'],
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

// Sentry wrapping is conditional — without SENTRY_AUTH_TOKEN the build skips source map uploads
const finalConfig =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG
    ? withSentryConfig(nextConfig, {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT ?? 'javascript-nextjs',
        silent: !process.env.CI,
      })
    : nextConfig;

export default withBundleAnalyzer(finalConfig);
