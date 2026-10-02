/**
 * Platform host configuration. Each NEXT_PUBLIC_* read is spelled out so Next
 * inlines it into client bundles; the defaults live in @celuneai/core/config.
 */

import { resolveHostConfig, type HostConfig } from '@celuneai/core/config';

export const hostConfig: HostConfig = resolveHostConfig({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
  NEXT_PUBLIC_MARKETING_DOMAIN: process.env.NEXT_PUBLIC_MARKETING_DOMAIN,
  NEXT_PUBLIC_DOCS_DOMAIN: process.env.NEXT_PUBLIC_DOCS_DOMAIN,
  NEXT_PUBLIC_PRODUCT_NAME: process.env.NEXT_PUBLIC_PRODUCT_NAME,
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_SALES_EMAIL: process.env.NEXT_PUBLIC_SALES_EMAIL,
  NEXT_PUBLIC_COOKIE_DOMAIN: process.env.NEXT_PUBLIC_COOKIE_DOMAIN,
  NEXT_PUBLIC_FONT_SANS: process.env.NEXT_PUBLIC_FONT_SANS,
  NEXT_PUBLIC_FONT_MONO: process.env.NEXT_PUBLIC_FONT_MONO,
  AGENT_MAIL_DOMAIN: process.env.AGENT_MAIL_DOMAIN,
  CELUNE_API_KEY_PREFIX: process.env.CELUNE_API_KEY_PREFIX,
  CELUNE_EDITION: process.env.CELUNE_EDITION,
  CELUNE_GATE_MODE: process.env.CELUNE_GATE_MODE,
  CELUNE_CLOUD_URL: process.env.CELUNE_CLOUD_URL,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
});

export type { HostConfig };
