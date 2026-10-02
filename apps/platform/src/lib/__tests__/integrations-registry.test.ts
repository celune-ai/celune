import { describe, it, expect } from 'vitest';
import { INTEGRATIONS, CATEGORY_LABELS, CATEGORY_ORDER } from '../integrations-registry';
import type { IntegrationId, IntegrationCategory } from '@repo/types';

describe('integrations-registry', () => {
  it('has all expected integration IDs', () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    const expected: IntegrationId[] = [
      'github',
      'anthropic',
      'openai',
      'elevenlabs',
      'groq',
      'slack',
      'stripe',
      'sentry',
      'railway',
      'supabase',
      'agentmail',
    ];
    for (const id of expected) {
      expect(ids).toContain(id);
    }
  });

  it('has no duplicate integration IDs', () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every integration has required fields', () => {
    for (const integration of INTEGRATIONS) {
      expect(integration.name).toBeTruthy();
      expect(integration.description).toBeTruthy();
      expect(integration.category).toBeTruthy();
      expect(integration.scope).toMatch(/^(workspace|platform)$/);
      expect(integration.url === '' || integration.url.startsWith('https://')).toBe(true);
      expect(integration.integration_type).toMatch(/^(native|mcp|coming_soon)$/);
    }
  });

  it('every integration category has a label', () => {
    const categories = new Set(INTEGRATIONS.map((i) => i.category));
    for (const cat of categories) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });

  it('CATEGORY_ORDER includes all used categories', () => {
    const usedCategories = new Set(INTEGRATIONS.map((i) => i.category));
    for (const cat of usedCategories) {
      expect(CATEGORY_ORDER).toContain(cat);
    }
  });

  it('workspace-scoped integrations include GitHub, Slack, AI providers', () => {
    const workspaceIntegrations = INTEGRATIONS.filter((i) => i.scope === 'workspace');
    const ids = workspaceIntegrations.map((i) => i.id);
    expect(ids).toContain('github');
    expect(ids).toContain('slack');
    expect(ids).toContain('anthropic');
  });

  it('platform-scoped integrations include Supabase, Railway, Sentry', () => {
    const platformIntegrations = INTEGRATIONS.filter((i) => i.scope === 'platform');
    const ids = platformIntegrations.map((i) => i.id);
    expect(ids).toContain('supabase');
    expect(ids).toContain('railway');
    expect(ids).toContain('sentry');
  });
});
