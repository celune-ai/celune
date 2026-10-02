import { describe, it, expect } from 'vitest';
import {
  generateBranchName,
  parseBranchName,
  formatContextLine,
  type ConversationContext,
} from '../github-context';
import type { BranchNamingConfig } from '@repo/types';

// ---------------------------------------------------------------------------
// generateBranchName
// ---------------------------------------------------------------------------

describe('generateBranchName', () => {
  const defaultConfig: BranchNamingConfig = {
    prefix: 'celune',
    separator: '/',
    include_assignee: true,
    slug_source: 'project_name',
  };

  it('generates branch with prefix, assignee, and slug', () => {
    const result = generateBranchName(defaultConfig, 'rick', 'Auth Middleware');
    expect(result).toBe('celune/rick/auth-middleware');
  });

  it('excludes assignee when include_assignee is false', () => {
    const config = { ...defaultConfig, include_assignee: false };
    const result = generateBranchName(config, 'rick', 'Auth Middleware');
    expect(result).toBe('celune/auth-middleware');
  });

  it('uses custom separator', () => {
    const config = { ...defaultConfig, separator: '-' };
    const result = generateBranchName(config, 'rick', 'Auth Middleware');
    expect(result).toBe('celune-rick-auth-middleware');
  });

  it('slugifies special characters', () => {
    const result = generateBranchName(defaultConfig, 'rick', 'Fix: API Errors & Bugs!!');
    expect(result).toBe('celune/rick/fix-api-errors-bugs');
  });

  it('truncates long slugs to 50 chars', () => {
    const longName =
      'This is a very long project name that should be truncated to fifty characters max';
    const result = generateBranchName(defaultConfig, 'rick', longName);
    const slug = result.split('/')[2];
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it('handles empty slug input', () => {
    const result = generateBranchName(defaultConfig, 'rick', '');
    expect(result).toBe('celune/rick/');
  });

  it('strips leading and trailing hyphens from slug', () => {
    const result = generateBranchName(defaultConfig, 'rick', '---hello---');
    expect(result).toBe('celune/rick/hello');
  });
});

// ---------------------------------------------------------------------------
// parseBranchName
// ---------------------------------------------------------------------------

describe('parseBranchName', () => {
  const defaultConfig: BranchNamingConfig = {
    prefix: 'celune',
    separator: '/',
    include_assignee: true,
    slug_source: 'project_name',
  };

  it('parses a branch with assignee', () => {
    const result = parseBranchName('celune/rick/auth-middleware', defaultConfig);
    expect(result).toEqual({
      prefix: 'celune',
      assignee: 'rick',
      slug: 'auth-middleware',
    });
  });

  it('parses a branch without assignee', () => {
    const config = { ...defaultConfig, include_assignee: false };
    const result = parseBranchName('celune/auth-middleware', config);
    expect(result).toEqual({
      prefix: 'celune',
      assignee: null,
      slug: 'auth-middleware',
    });
  });

  it('returns null for non-matching branch', () => {
    const result = parseBranchName('feature/something', defaultConfig);
    expect(result).toBeNull();
  });

  it('returns null for main branch', () => {
    const result = parseBranchName('main', defaultConfig);
    expect(result).toBeNull();
  });

  it('round-trips with generateBranchName', () => {
    const generated = generateBranchName(defaultConfig, 'noir', 'Design System Update');
    const parsed = parseBranchName(generated, defaultConfig);
    expect(parsed).toEqual({
      prefix: 'celune',
      assignee: 'noir',
      slug: 'design-system-update',
    });
  });

  it('handles hyphen separator with assignee', () => {
    const config: BranchNamingConfig = {
      prefix: 'feat',
      separator: '-',
      include_assignee: true,
      slug_source: 'project_name',
    };
    const result = parseBranchName('feat-rick-auth-flow', config);
    expect(result).toEqual({
      prefix: 'feat',
      assignee: 'rick',
      slug: 'auth-flow',
    });
  });

  it('handles multi-segment slug with / separator', () => {
    const result = parseBranchName('celune/rick/multi-part-slug-name', defaultConfig);
    expect(result).toEqual({
      prefix: 'celune',
      assignee: 'rick',
      slug: 'multi-part-slug-name',
    });
  });
});

// ---------------------------------------------------------------------------
// formatContextLine
// ---------------------------------------------------------------------------

describe('formatContextLine', () => {
  const baseContext: ConversationContext = {
    workspace_id: 'ws-1',
    workspace_name: 'Test Workspace',
    project_id: null,
    project_name: null,
    branch: 'celune/rick/test',
    pr_number: null,
    pr_status: null,
    pr_url: null,
    ci_status: null,
    review_state: null,
    tasks_remaining: null,
    updated_at: new Date().toISOString(),
  };

  it('shows no-project message when project_name is null', () => {
    const result = formatContextLine(baseContext);
    expect(result.has_project).toBe(false);
    expect(result.has_pr).toBe(false);
    expect(result.line).toContain('no linked project');
    expect(result.line).toContain('celune/rick/test');
  });

  it('shows project name when available', () => {
    const ctx = { ...baseContext, project_id: 'p-1', project_name: 'Auth System' };
    const result = formatContextLine(ctx);
    expect(result.has_project).toBe(true);
    expect(result.line).toContain('**Auth System**');
  });

  it('includes PR number and status', () => {
    const ctx = {
      ...baseContext,
      project_id: 'p-1',
      project_name: 'Auth System',
      pr_number: 42,
      pr_status: 'draft',
    };
    const result = formatContextLine(ctx);
    expect(result.has_pr).toBe(true);
    expect(result.line).toContain('PR #42');
    expect(result.line).toContain('(draft)');
  });

  it('includes merged status', () => {
    const ctx = {
      ...baseContext,
      project_id: 'p-1',
      project_name: 'Auth System',
      pr_number: 42,
      pr_status: 'merged',
    };
    const result = formatContextLine(ctx);
    expect(result.line).toContain('(merged)');
  });

  it('shows CI status when failing', () => {
    const ctx = {
      ...baseContext,
      project_id: 'p-1',
      project_name: 'Auth System',
      pr_number: 42,
      pr_status: 'open',
      ci_status: 'failing',
    };
    const result = formatContextLine(ctx);
    expect(result.line).toContain('CI failing');
  });

  it('shows tasks remaining', () => {
    const ctx = {
      ...baseContext,
      project_id: 'p-1',
      project_name: 'Auth System',
      tasks_remaining: 5,
    };
    const result = formatContextLine(ctx);
    expect(result.line).toContain('5 tasks remaining');
  });

  it('hides tasks remaining when zero', () => {
    const ctx = {
      ...baseContext,
      project_id: 'p-1',
      project_name: 'Auth System',
      tasks_remaining: 0,
    };
    const result = formatContextLine(ctx);
    expect(result.line).not.toContain('tasks remaining');
  });
});
