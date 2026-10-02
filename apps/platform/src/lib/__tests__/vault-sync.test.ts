import { describe, it, expect, vi } from 'vitest';

// Mock server-side dependencies before importing
vi.mock('@/lib/memory-helpers', () => ({
  fireAndForgetEmbedding: vi.fn(),
}));
vi.mock('@repo/db/service', () => ({
  createServiceClient: vi.fn(),
}));

const { parseCeluneSync, isPathAllowed, resolveCategory, isAllowedVaultRoot } =
  await import('../vault-sync');
type SyncConfig = { allowedPaths: string[]; categoryMap: Record<string, string> };

describe('parseCeluneSync', () => {
  it('parses path entries', () => {
    const config = parseCeluneSync('01-daily/\n05-knowledge/\n');
    expect(config.allowedPaths).toEqual(['01-daily', '05-knowledge']);
  });

  it('ignores comments and blank lines', () => {
    const config = parseCeluneSync('# This is a comment\n\n01-daily/\n# Another comment\n');
    expect(config.allowedPaths).toEqual(['01-daily']);
  });

  it('parses category overrides', () => {
    const config = parseCeluneSync('01-daily/\n\n[categories]\n06-influences=inspiration\n');
    expect(config.categoryMap['06-influences']).toBe('inspiration');
    // Default categories preserved
    expect(config.categoryMap['01-daily']).toBe('daily-plan');
  });

  it('returns empty allowedPaths for empty file', () => {
    const config = parseCeluneSync('');
    expect(config.allowedPaths).toEqual([]);
  });

  it('strips trailing slashes from paths', () => {
    const config = parseCeluneSync('04-projects/celune/');
    expect(config.allowedPaths).toEqual(['04-projects/celune']);
  });

  it('strips trailing slashes from category keys', () => {
    const config = parseCeluneSync('[categories]\n04-projects/=project\n');
    expect(config.categoryMap['04-projects']).toBe('project');
  });
});

describe('isPathAllowed', () => {
  const config: SyncConfig = {
    allowedPaths: ['01-daily', '05-knowledge', '04-projects/celune'],
    categoryMap: {},
  };

  it('allows exact match', () => {
    expect(isPathAllowed('01-daily', config)).toBe(true);
  });

  it('allows files within allowed directory', () => {
    expect(isPathAllowed('01-daily/2026-03-23-projects.md', config)).toBe(true);
    expect(isPathAllowed('05-knowledge/programming/rust.md', config)).toBe(true);
  });

  it('allows nested allowed path', () => {
    expect(isPathAllowed('04-projects/celune/roadmap.md', config)).toBe(true);
  });

  it('rejects paths not in allowlist', () => {
    expect(isPathAllowed('02-personal/journal.md', config)).toBe(false);
    expect(isPathAllowed('07-archive/old-stuff.md', config)).toBe(false);
  });

  it('rejects sibling of allowed nested path', () => {
    expect(isPathAllowed('04-projects/other-project/readme.md', config)).toBe(false);
  });

  it('rejects everything when allowedPaths is empty', () => {
    const empty: SyncConfig = { allowedPaths: [], categoryMap: {} };
    expect(isPathAllowed('01-daily/plan.md', empty)).toBe(false);
  });
});

describe('resolveCategory', () => {
  const config: SyncConfig = {
    allowedPaths: [],
    categoryMap: {
      '01-daily': 'daily-plan',
      '04-projects': 'project',
      '05-knowledge': 'reference',
      '04-projects/celune': 'celune-project',
    },
  };

  it('resolves top-level folder category', () => {
    expect(resolveCategory('01-daily/2026-03-23.md', config)).toBe('daily-plan');
  });

  it('resolves nested folder category (deepest match)', () => {
    expect(resolveCategory('04-projects/celune/brain.md', config)).toBe('celune-project');
  });

  it('falls back to parent folder', () => {
    expect(resolveCategory('04-projects/other/readme.md', config)).toBe('project');
  });

  it('defaults to reference for unknown paths', () => {
    expect(resolveCategory('unknown-folder/file.md', config)).toBe('reference');
  });

  it('maps all default PARA folders correctly', () => {
    const defaultConfig: SyncConfig = {
      allowedPaths: [],
      categoryMap: {
        '00-inbox': 'inbox',
        '01-daily': 'daily-plan',
        '02-personal': 'personal',
        '03-professional': 'professional',
        '04-projects': 'project',
        '05-knowledge': 'reference',
        '06-influences': 'reference',
        '07-archive': 'archive',
      },
    };
    expect(resolveCategory('00-inbox/new-idea.md', defaultConfig)).toBe('inbox');
    expect(resolveCategory('02-personal/journal.md', defaultConfig)).toBe('personal');
    expect(resolveCategory('03-professional/resume.md', defaultConfig)).toBe('professional');
    expect(resolveCategory('07-archive/old.md', defaultConfig)).toBe('archive');
  });
});

describe('parseCeluneSync edge cases', () => {
  it('handles mixed path and category sections', () => {
    const input = [
      '# Vault sync config',
      '01-daily/',
      '05-knowledge/',
      '',
      '[categories]',
      '# Custom mappings',
      '05-knowledge=research',
      '01-daily=plans',
    ].join('\n');

    const config = parseCeluneSync(input);
    expect(config.allowedPaths).toEqual(['01-daily', '05-knowledge']);
    expect(config.categoryMap['05-knowledge']).toBe('research');
    expect(config.categoryMap['01-daily']).toBe('plans');
  });

  it('preserves defaults for unmapped categories', () => {
    const config = parseCeluneSync('[categories]\n06-influences=inspiration\n');
    // Override applies
    expect(config.categoryMap['06-influences']).toBe('inspiration');
    // Defaults still present
    expect(config.categoryMap['04-projects']).toBe('project');
    expect(config.categoryMap['01-daily']).toBe('daily-plan');
  });
});

describe('isAllowedVaultRoot', () => {
  it('rejects relative paths', () => {
    expect(isAllowedVaultRoot('relative/path')).toBe(false);
    expect(isAllowedVaultRoot('./Documents')).toBe(false);
  });

  it('allows paths under HOME', () => {
    const home = process.env.HOME ?? '/Users';
    expect(isAllowedVaultRoot(`${home}/Documents/vault`)).toBe(true);
  });

  it('rejects system paths', () => {
    // Only rejected if not under HOME — /etc is never under user home
    expect(isAllowedVaultRoot('/etc/passwd')).toBe(false);
    expect(isAllowedVaultRoot('/var/secrets')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedVaultRoot('')).toBe(false);
  });
});
