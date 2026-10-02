import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

const mockFrom = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({ data: [], error: null })),
      })),
    })),
  })),
  insert: mockInsert,
  update: mockUpdate,
}));

vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

/* ------------------------------------------------------------------ */
/*  Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import {
  CORE_KNOWLEDGE,
  GITHUB_PACK,
  SLACK_PACK,
  VOICE_PACK,
  BYOK_PACK,
  AGENT_MEMORIES,
  INTEGRATION_PACKS,
  getIntegrationMemoryCount,
  getAllMemoryCounts,
  generateWorkspaceClaudeMd,
  type SeedMemory,
} from '@/lib/seed-knowledge-packs';

/* ------------------------------------------------------------------ */
/*  Data Validation Tests                                              */
/* ------------------------------------------------------------------ */

describe('seed memory data integrity', () => {
  const allPacks: { name: string; pack: SeedMemory[] }[] = [
    { name: 'CORE_KNOWLEDGE', pack: CORE_KNOWLEDGE },
    { name: 'GITHUB_PACK', pack: GITHUB_PACK },
    { name: 'SLACK_PACK', pack: SLACK_PACK },
    { name: 'VOICE_PACK', pack: VOICE_PACK },
    { name: 'BYOK_PACK', pack: BYOK_PACK },
    { name: 'AGENT_MEMORIES', pack: AGENT_MEMORIES },
  ];

  it.each(allPacks)('$name — all keys are unique', ({ pack }) => {
    const keys = pack.map((m) => m.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it.each(allPacks)('$name — all importance_scores are 0-100 range', ({ pack }) => {
    for (const m of pack) {
      expect(m.importance_score).toBeGreaterThanOrEqual(0);
      expect(m.importance_score).toBeLessThanOrEqual(100);
    }
  });

  it.each(allPacks)('$name — all entries have required fields', ({ pack }) => {
    for (const m of pack) {
      expect(m.key).toBeTruthy();
      expect(m.content).toBeTruthy();
      expect(m.category).toBeTruthy();
      expect(m.memory_type).toBeTruthy();
      expect(typeof m.importance_score).toBe('number');
    }
  });

  it('CORE_KNOWLEDGE has null integration on all entries', () => {
    for (const m of CORE_KNOWLEDGE) {
      expect(m.integration).toBeNull();
    }
  });

  it('GITHUB_PACK has github integration on all entries', () => {
    for (const m of GITHUB_PACK) {
      expect(m.integration).toBe('github');
    }
  });

  it('SLACK_PACK has slack integration on all entries', () => {
    for (const m of SLACK_PACK) {
      expect(m.integration).toBe('slack');
    }
  });

  it('VOICE_PACK has voice integration on all entries', () => {
    for (const m of VOICE_PACK) {
      expect(m.integration).toBe('voice');
    }
  });

  it('BYOK_PACK has byok integration on all entries', () => {
    for (const m of BYOK_PACK) {
      expect(m.integration).toBe('byok');
    }
  });

  it('AGENT_MEMORIES all have agent_id set', () => {
    for (const m of AGENT_MEMORIES) {
      expect(m.agent_id).toBeTruthy();
    }
  });

  it('no duplicate keys across all packs', () => {
    const allKeys = allPacks.flatMap(({ pack }) => pack.map((m) => m.key));
    const uniqueKeys = new Set(allKeys);
    expect(uniqueKeys.size).toBe(allKeys.length);
  });

  it('importance_score normalization produces valid 0-1 range', () => {
    const allMemories = allPacks.flatMap(({ pack }) => pack);
    for (const m of allMemories) {
      const normalized = m.importance_score > 1 ? m.importance_score / 100 : m.importance_score;
      expect(normalized).toBeGreaterThanOrEqual(0);
      expect(normalized).toBeLessThanOrEqual(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  getIntegrationMemoryCount                                          */
/* ------------------------------------------------------------------ */

describe('getIntegrationMemoryCount', () => {
  it('returns correct count for github', () => {
    expect(getIntegrationMemoryCount('github')).toBe(GITHUB_PACK.length);
  });

  it('returns correct count for slack', () => {
    expect(getIntegrationMemoryCount('slack')).toBe(SLACK_PACK.length);
  });

  it('returns correct count for voice', () => {
    expect(getIntegrationMemoryCount('voice')).toBe(VOICE_PACK.length);
  });

  it('returns correct count for byok', () => {
    expect(getIntegrationMemoryCount('byok')).toBe(BYOK_PACK.length);
  });
});

/* ------------------------------------------------------------------ */
/*  getAllMemoryCounts                                                  */
/* ------------------------------------------------------------------ */

describe('getAllMemoryCounts', () => {
  it('returns counts for all groups', () => {
    const counts = getAllMemoryCounts();
    expect(counts).toEqual({
      core: CORE_KNOWLEDGE.length,
      github: GITHUB_PACK.length,
      slack: SLACK_PACK.length,
      voice: VOICE_PACK.length,
      byok: BYOK_PACK.length,
      agents: AGENT_MEMORIES.length,
    });
  });

  it('all counts are positive', () => {
    const counts = getAllMemoryCounts();
    for (const [key, count] of Object.entries(counts)) {
      expect(count, `${key} should have at least 1 memory`).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  INTEGRATION_PACKS registry                                         */
/* ------------------------------------------------------------------ */

describe('INTEGRATION_PACKS', () => {
  it('has all four integration groups', () => {
    expect(Object.keys(INTEGRATION_PACKS).sort()).toEqual(['byok', 'github', 'slack', 'voice']);
  });

  it('each pack is non-empty', () => {
    for (const [key, pack] of Object.entries(INTEGRATION_PACKS)) {
      expect(pack.length, `${key} pack should not be empty`).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  generateWorkspaceClaudeMd                                          */
/* ------------------------------------------------------------------ */

describe('generateWorkspaceClaudeMd', () => {
  it('generates markdown with workspace name as heading', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'My Project',
      role: 'Engineer',
      goal: 'Ship fast',
      autonomy: 'full',
      domain: 'SaaS',
    });
    expect(result).toMatch(/^# My Project\n/);
  });

  it('includes role, goal, and domain in context section', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: 'Designer',
      goal: 'Create beautiful UIs',
      autonomy: 'collaborative',
      domain: 'E-commerce',
    });
    expect(result).toContain('**Role:** Designer');
    expect(result).toContain('**Primary goal:** Create beautiful UIs');
    expect(result).toContain('**Domain:** E-commerce');
  });

  it('handles full autonomy mode', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: 'Dev',
      goal: 'Build',
      autonomy: 'full',
      domain: '',
    });
    expect(result).toContain('Full autonomy');
    expect(result).toContain('proceed without asking');
  });

  it('handles guided autonomy mode', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: 'Dev',
      goal: 'Build',
      autonomy: 'guided',
      domain: '',
    });
    expect(result).toContain('Guided mode');
    expect(result).toContain('explain your plan before executing');
  });

  it('handles collaborative autonomy mode (default)', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: 'Dev',
      goal: 'Build',
      autonomy: 'collaborative',
      domain: '',
    });
    expect(result).toContain('Collaborative mode');
    expect(result).toContain('discuss approach');
  });

  it('handles unknown autonomy mode as collaborative', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: 'Dev',
      goal: 'Build',
      autonomy: 'unknown',
      domain: '',
    });
    expect(result).toContain('Collaborative mode');
  });

  it('omits empty fields from context section', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: '',
      goal: 'Build stuff',
      autonomy: 'full',
      domain: '',
    });
    expect(result).not.toContain('**Role:**');
    expect(result).toContain('**Primary goal:** Build stuff');
    expect(result).not.toContain('**Domain:**');
  });

  it('shows "General workspace" when all context fields are empty', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Empty',
      role: '',
      goal: '',
      autonomy: 'full',
      domain: '',
    });
    expect(result).toContain('General workspace');
  });

  it('includes standard sections', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: 'Dev',
      goal: 'Build',
      autonomy: 'full',
      domain: 'Tech',
    });
    expect(result).toContain('## Context');
    expect(result).toContain('## Working Style');
    expect(result).toContain('## Task Conventions');
    expect(result).toContain('## Commit Protocol');
    expect(result).toContain('## Quality Gates');
    expect(result).toContain('## Memory');
  });

  it('does not produce consecutive blank lines', () => {
    const result = generateWorkspaceClaudeMd({
      workspaceName: 'Test',
      role: '',
      goal: '',
      autonomy: 'full',
      domain: '',
    });
    expect(result).not.toMatch(/\n\n\n/);
  });
});
