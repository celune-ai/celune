/**
 * Host configuration: every brand, URL, prefix, and edition value the open
 * packages need. Defaults describe Celune Cloud; a self-host overrides them
 * through environment variables. This is the only open file that may name
 * Celune's domains.
 */

export type Edition = 'cloud' | 'community';
export type GateMode = 'cloud' | 'noop';

export interface HostConfig {
  appUrl: string;
  appDomain: string;
  marketingDomain: string;
  docsDomain: string;
  marketingUrl: string;
  docsUrl: string;
  statusUrl: string;
  productName: string;
  supportEmail: string;
  /** Where Enterprise inquiries go. */
  salesEmail: string;
  cookieDomain: string | undefined;
  agentMailDomain: string;
  apiKeyPrefix: string;
  fontSans: string;
  fontMono: string;
  edition: Edition;
  gateMode: GateMode;
  /** Celune Cloud app URL, the target of the self-host to Cloud migration. */
  cloudUrl: string;
}

export type HostEnv = Record<string, string | undefined>;

export const HOST_DEFAULTS = {
  appDomain: 'app.celune.ai',
  marketingDomain: 'celune.ai',
  docsDomain: 'docs.celune.ai',
  productName: 'Celune',
  supportEmail: 'hello@celune.ai',
  salesEmail: 'hello@celune.ai',
  apiKeyPrefix: 'celune',
  fontSans:
    "'Inter Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontMono:
    "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

function pick(env: HostEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** `app.example.com` -> `.example.com`; single-label hosts get no cookie domain. */
export function parentCookieDomain(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const labels = host.split(':')[0]!.split('.').filter(Boolean);
  if (labels.length < 3) return undefined;
  return `.${labels.slice(1).join('.')}`;
}

function detectEdition(env: HostEnv, appDomain: string | undefined): Edition {
  const explicit = pick(env, 'CELUNE_EDITION');
  if (explicit === 'cloud' || explicit === 'community') return explicit;
  if (pick(env, 'STRIPE_SECRET_KEY')) return 'cloud';
  if (appDomain && appDomain.endsWith(HOST_DEFAULTS.marketingDomain)) return 'cloud';
  return 'community';
}

function detectGateMode(env: HostEnv, edition: Edition): GateMode {
  const explicit = pick(env, 'CELUNE_GATE_MODE');
  if (explicit === 'cloud' || explicit === 'noop') return explicit;
  return edition === 'cloud' ? 'cloud' : 'noop';
}

// core has no node types; read the process env through globalThis so browsers and edge runtimes stay safe
const runtimeEnv = (): HostEnv =>
  (globalThis as { process?: { env?: HostEnv } }).process?.env ?? {};

export function resolveHostConfig(env: HostEnv = runtimeEnv()): HostConfig {
  const appDomainEnv = pick(env, 'NEXT_PUBLIC_APP_DOMAIN');
  const appDomain = appDomainEnv ?? HOST_DEFAULTS.appDomain;
  const marketingDomain =
    pick(env, 'NEXT_PUBLIC_MARKETING_DOMAIN') ?? HOST_DEFAULTS.marketingDomain;
  const docsDomain = pick(env, 'NEXT_PUBLIC_DOCS_DOMAIN') ?? HOST_DEFAULTS.docsDomain;
  const edition = detectEdition(env, appDomainEnv);
  return {
    appUrl: pick(env, 'NEXT_PUBLIC_APP_URL') ?? `https://${appDomain}`,
    appDomain,
    marketingDomain,
    docsDomain,
    marketingUrl: `https://${marketingDomain}`,
    docsUrl: `https://${docsDomain}`,
    statusUrl: `https://status.${marketingDomain}`,
    productName: pick(env, 'NEXT_PUBLIC_PRODUCT_NAME') ?? HOST_DEFAULTS.productName,
    supportEmail: pick(env, 'NEXT_PUBLIC_SUPPORT_EMAIL') ?? HOST_DEFAULTS.supportEmail,
    salesEmail: pick(env, 'NEXT_PUBLIC_SALES_EMAIL') ?? HOST_DEFAULTS.salesEmail,
    cookieDomain: pick(env, 'NEXT_PUBLIC_COOKIE_DOMAIN') ?? parentCookieDomain(appDomainEnv),
    agentMailDomain: pick(env, 'AGENT_MAIL_DOMAIN') ?? marketingDomain,
    apiKeyPrefix: pick(env, 'CELUNE_API_KEY_PREFIX') ?? HOST_DEFAULTS.apiKeyPrefix,
    fontSans: pick(env, 'NEXT_PUBLIC_FONT_SANS') ?? HOST_DEFAULTS.fontSans,
    fontMono: pick(env, 'NEXT_PUBLIC_FONT_MONO') ?? HOST_DEFAULTS.fontMono,
    edition,
    gateMode: detectGateMode(env, edition),
    cloudUrl: (pick(env, 'CELUNE_CLOUD_URL') ?? `https://${HOST_DEFAULTS.appDomain}`).replace(
      /\/+$/,
      '',
    ),
  };
}
