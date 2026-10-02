import { describe, it, expect } from 'vitest';
import { HOST_DEFAULTS, parentCookieDomain, resolveHostConfig } from '../config.ts';

describe('resolveHostConfig', () => {
  it('falls back to the hosted defaults and the community edition', () => {
    const config = resolveHostConfig({});
    expect(config.appDomain).toBe(HOST_DEFAULTS.appDomain);
    expect(config.appUrl).toBe(`https://${HOST_DEFAULTS.appDomain}`);
    expect(config.marketingUrl).toBe(`https://${HOST_DEFAULTS.marketingDomain}`);
    expect(config.docsUrl).toBe(`https://${HOST_DEFAULTS.docsDomain}`);
    expect(config.statusUrl).toBe(`https://status.${HOST_DEFAULTS.marketingDomain}`);
    expect(config.productName).toBe(HOST_DEFAULTS.productName);
    expect(config.supportEmail).toBe(HOST_DEFAULTS.supportEmail);
    expect(config.salesEmail).toBe(HOST_DEFAULTS.salesEmail);
    expect(config.apiKeyPrefix).toBe(HOST_DEFAULTS.apiKeyPrefix);
    expect(config.agentMailDomain).toBe(HOST_DEFAULTS.marketingDomain);
    expect(config.cookieDomain).toBeUndefined();
    expect(config.fontSans).toBe(HOST_DEFAULTS.fontSans);
    expect(config.edition).toBe('community');
    expect(config.gateMode).toBe('noop');
    expect(config.cloudUrl).toBe(`https://${HOST_DEFAULTS.appDomain}`);
  });

  it('reads every value from the environment', () => {
    const config = resolveHostConfig({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3002',
      NEXT_PUBLIC_APP_DOMAIN: 'pm.example.com',
      NEXT_PUBLIC_MARKETING_DOMAIN: 'example.com',
      NEXT_PUBLIC_DOCS_DOMAIN: 'docs.example.com',
      NEXT_PUBLIC_PRODUCT_NAME: 'Acme PM',
      NEXT_PUBLIC_SUPPORT_EMAIL: 'help@example.com',
      NEXT_PUBLIC_SALES_EMAIL: 'sales@example.com',
      NEXT_PUBLIC_COOKIE_DOMAIN: '.example.com',
      AGENT_MAIL_DOMAIN: 'agents.example.com',
      CELUNE_API_KEY_PREFIX: 'acme',
      NEXT_PUBLIC_FONT_SANS: 'Georgia, serif',
      NEXT_PUBLIC_FONT_MONO: 'Courier, monospace',
      CELUNE_EDITION: 'community',
      CELUNE_GATE_MODE: 'noop',
      CELUNE_CLOUD_URL: 'https://cloud.example.com/',
    });
    expect(config).toMatchObject({
      appUrl: 'http://localhost:3002',
      appDomain: 'pm.example.com',
      marketingUrl: 'https://example.com',
      docsUrl: 'https://docs.example.com',
      statusUrl: 'https://status.example.com',
      productName: 'Acme PM',
      supportEmail: 'help@example.com',
      salesEmail: 'sales@example.com',
      cookieDomain: '.example.com',
      agentMailDomain: 'agents.example.com',
      apiKeyPrefix: 'acme',
      fontSans: 'Georgia, serif',
      fontMono: 'Courier, monospace',
      edition: 'community',
      gateMode: 'noop',
      cloudUrl: 'https://cloud.example.com',
    });
  });

  it('derives the cookie domain from the configured app domain', () => {
    expect(resolveHostConfig({ NEXT_PUBLIC_APP_DOMAIN: 'app.example.com' }).cookieDomain).toBe(
      '.example.com',
    );
    expect(parentCookieDomain('localhost:3002')).toBeUndefined();
    expect(parentCookieDomain('example.com')).toBeUndefined();
    expect(parentCookieDomain('a.b.example.com')).toBe('.b.example.com');
  });

  it('detects the cloud edition from billing or the hosted domain', () => {
    expect(resolveHostConfig({ STRIPE_SECRET_KEY: 'x' }).edition).toBe('cloud');
    expect(resolveHostConfig({ NEXT_PUBLIC_APP_DOMAIN: HOST_DEFAULTS.appDomain }).edition).toBe(
      'cloud',
    );
    expect(resolveHostConfig({ NEXT_PUBLIC_APP_DOMAIN: 'pm.example.com' }).edition).toBe(
      'community',
    );
  });

  it('gate mode follows the edition unless overridden', () => {
    expect(resolveHostConfig({ STRIPE_SECRET_KEY: 'x' }).gateMode).toBe('cloud');
    expect(resolveHostConfig({ STRIPE_SECRET_KEY: 'x', CELUNE_GATE_MODE: 'noop' }).gateMode).toBe(
      'noop',
    );
    expect(resolveHostConfig({ CELUNE_GATE_MODE: 'cloud' }).gateMode).toBe('cloud');
    expect(resolveHostConfig({ CELUNE_EDITION: 'cloud' }).gateMode).toBe('cloud');
    expect(resolveHostConfig({ CELUNE_GATE_MODE: 'bogus' }).gateMode).toBe('noop');
  });
});
