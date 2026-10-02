/**
 * Branding constants for the platform app, read from host configuration.
 * All user-facing brand strings should reference this module.
 */

import { hostConfig } from '@/lib/host-config';

// ─── Core identity ──────────────────────────────────────────────────────────

export const APP_NAME = hostConfig.productName;
export const APP_TAGLINE = 'Agentic Engineering on Autopilot';
export const APP_DESCRIPTION = 'Your second brain for work';
export const COMPANY_NAME = hostConfig.productName;

// ─── Domains ─────────────────────────────────────────────────────────────────

export const DOMAIN_APP = hostConfig.appDomain;
export const DOMAIN_MARKETING = hostConfig.marketingDomain;
export const DOMAIN_DOCS = hostConfig.docsDomain;

// ─── URLs ────────────────────────────────────────────────────────────────────

/** Runtime app origin (NEXT_PUBLIC_APP_URL); differs from URL_APP in local dev. */
export const APP_URL = hostConfig.appUrl;
export const URL_APP = `https://${DOMAIN_APP}`;
export const URL_MARKETING = hostConfig.marketingUrl;
export const URL_DOCS = hostConfig.docsUrl;
export const URL_STATUS = hostConfig.statusUrl;
export const URL_LOGIN = `${URL_APP}/login`;

// ─── Contact ─────────────────────────────────────────────────────────────────

export const SUPPORT_EMAIL = hostConfig.supportEmail;
export const SALES_EMAIL = hostConfig.salesEmail;

// ─── Social / external ──────────────────────────────────────────────────────

export const SOCIAL_GITHUB = 'https://github.com/celune-ai';
export const SOCIAL_TWITTER = 'https://x.com/celune_ai';

// ─── Sentry ──────────────────────────────────────────────────────────────────

export const SENTRY_ORG = process.env.SENTRY_ORG ?? '';
export const SENTRY_PROJECT = process.env.SENTRY_PROJECT ?? 'javascript-nextjs';

// ─── Copyright ───────────────────────────────────────────────────────────────

export const COPYRIGHT = `© ${new Date().getFullYear()} ${COMPANY_NAME}. All rights reserved.`;
