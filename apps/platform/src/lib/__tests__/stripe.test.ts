import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PLAN_TIERS } from '@repo/types';
import { cloudPriceId, getPlanLimits, priceIdToPlan } from '../stripe';

beforeEach(() => {
  vi.stubEnv('STRIPE_PRICE_CLOUD_MONTHLY', 'price_cloud_month');
  vi.stubEnv('STRIPE_PRICE_CLOUD_ANNUAL', 'price_cloud_year');
  vi.stubEnv('STRIPE_PRICE_PRO', 'price_legacy_pro');
  vi.stubEnv('STRIPE_PRICE_UNLIMITED', 'price_legacy_unlimited');
  vi.stubEnv('STRIPE_PRICE_TEAM', 'price_legacy_team');
  vi.stubEnv('STRIPE_PRICE_BUILD', 'price_legacy_build');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('cloudPriceId', () => {
  it('returns one price per interval', () => {
    expect(cloudPriceId('month')).toBe('price_cloud_month');
    expect(cloudPriceId('year')).toBe('price_cloud_year');
  });

  it('returns an empty string when the price is not configured', () => {
    vi.stubEnv('STRIPE_PRICE_CLOUD_ANNUAL', undefined as unknown as string);
    expect(cloudPriceId('year')).toBe('');
  });
});

describe('priceIdToPlan', () => {
  it('maps both Cloud prices to cloud', () => {
    expect(priceIdToPlan('price_cloud_month')).toBe('cloud');
    expect(priceIdToPlan('price_cloud_year')).toBe('cloud');
  });

  it('maps every legacy price env var to cloud without logging', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const id of [
      'price_legacy_pro',
      'price_legacy_unlimited',
      'price_legacy_team',
      'price_legacy_build',
    ]) {
      expect(priceIdToPlan(id)).toBe('cloud');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('grants nothing for an unknown or missing price and logs it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(priceIdToPlan('price_unknown')).toBeNull();
    expect(priceIdToPlan('')).toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('getPlanLimits', () => {
  it('gives legacy plan names the Cloud limits, which are all unset', () => {
    for (const legacy of ['builder', 'pro', 'unlimited', 'team', 'build', 'free']) {
      expect(getPlanLimits(legacy)).toBe(PLAN_TIERS.cloud);
    }
    const { features, ...numeric } = PLAN_TIERS.cloud;
    expect(Object.values(numeric).every((v) => v === null)).toBe(true);
    expect(features).toContain('byok');
  });

  it('keeps Enterprise features for enterprise', () => {
    expect(getPlanLimits('enterprise').features).toContain('governance_tools');
  });
});
