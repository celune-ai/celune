import { describe, it, expect } from 'vitest';
import { computeSectionMerge, type SectionMergeResult } from '../brain/section-diff';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function md(...lines: string[]): string {
  return lines.join('\n');
}

/** Shorthand to find an entry by key in a merge result array. */
function findByKey<T extends { key: string }>(arr: T[], key: string): T | undefined {
  return arr.find((e) => e.key === key);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeSectionMerge', () => {
  describe('basic merge scenarios', () => {
    it('marks sections unchanged when all three versions match', () => {
      const content = md('# Setup', 'Install deps', '', '# Usage', 'Run the app');
      const result = computeSectionMerge(content, content, content);

      expect(result.unchanged).toHaveLength(2);
      expect(result.autoMerged).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('auto-merges when local is unchanged but new has updates (accept-new)', () => {
      const base = md('# Setup', 'Install deps', '', '# Usage', 'Run the app');
      const local = base; // unchanged
      const updated = md('# Setup', 'Install deps v2', '', '# Usage', 'Run the app');

      const result = computeSectionMerge(base, local, updated);

      expect(result.autoMerged).toHaveLength(1);
      expect(result.autoMerged[0].key).toBe('setup');
      expect(result.autoMerged[0].source).toBe('new');
      expect(result.autoMerged[0].content).toContain('Install deps v2');

      // usage is unchanged
      expect(findByKey(result.unchanged, 'usage')).toBeDefined();
    });

    it('keeps local when user changed section but new matches base (keep-local)', () => {
      const base = md('# Setup', 'Install deps', '', '# Usage', 'Run the app');
      const local = md('# Setup', 'My custom install steps', '', '# Usage', 'Run the app');
      const updated = base; // template unchanged

      const result = computeSectionMerge(base, local, updated);

      // Keep-local sections appear in unchanged since they need no action
      expect(result.unchanged).toHaveLength(2);
      expect(findByKey(result.unchanged, 'setup')?.content).toContain('My custom install steps');
      expect(result.autoMerged).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });

    it('flags conflict when both local and new changed differently', () => {
      const base = md('# Setup', 'Install deps');
      const local = md('# Setup', 'My custom steps');
      const updated = md('# Setup', 'New template steps');

      const result = computeSectionMerge(base, local, updated);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe('setup');
      expect(result.conflicts[0].baseContent).toContain('Install deps');
      expect(result.conflicts[0].localContent).toContain('My custom steps');
      expect(result.conflicts[0].newContent).toContain('New template steps');
    });

    it('treats as unchanged when both local and new changed to the same content', () => {
      const base = md('# Setup', 'Install deps');
      const local = md('# Setup', 'Same new content');
      const updated = md('# Setup', 'Same new content');

      const result = computeSectionMerge(base, local, updated);

      expect(result.unchanged).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('added sections', () => {
    it('auto-adds sections that exist in new but not in base', () => {
      const base = md('# Setup', 'Install deps');
      const local = base;
      const updated = md('# Setup', 'Install deps', '', '# Advanced', 'Extra config');

      const result = computeSectionMerge(base, local, updated);

      const added = findByKey(result.autoMerged, 'advanced');
      expect(added).toBeDefined();
      expect(added!.source).toBe('added');
      expect(added!.content).toContain('Extra config');
    });

    it('handles added sections mixed with unchanged sections', () => {
      const base = md('# One', 'Content one', '', '# Three', 'Content three');
      const local = base;
      const updated = md(
        '# One',
        'Content one',
        '',
        '# Two',
        'New section',
        '',
        '# Three',
        'Content three',
      );

      const result = computeSectionMerge(base, local, updated);

      expect(result.autoMerged).toHaveLength(1);
      expect(result.autoMerged[0].key).toBe('two');
      expect(result.autoMerged[0].source).toBe('added');
      expect(result.unchanged).toHaveLength(2);
    });
  });

  describe('removed sections', () => {
    it('flags sections removed in new that still exist locally', () => {
      const base = md('# Setup', 'Install deps', '', '# Deprecated', 'Old stuff');
      const local = base;
      const updated = md('# Setup', 'Install deps');

      const result = computeSectionMerge(base, local, updated);

      expect(result.removed).toHaveLength(1);
      expect(result.removed[0].key).toBe('deprecated');
      expect(result.removed[0].localContent).toContain('Old stuff');
    });

    it('does not flag sections removed by both local and new', () => {
      const base = md('# Setup', 'Install deps', '', '# Old', 'Removed');
      const local = md('# Setup', 'Install deps');
      const updated = md('# Setup', 'Install deps');

      const result = computeSectionMerge(base, local, updated);

      expect(result.removed).toHaveLength(0);
      expect(result.unchanged).toHaveLength(1);
    });
  });

  describe('user-added sections', () => {
    it('keeps user-added sections not in base or new as unchanged', () => {
      const base = md('# Setup', 'Install deps');
      const local = md('# Setup', 'Install deps', '', '# My Notes', 'Personal stuff');
      const updated = base;

      const result = computeSectionMerge(base, local, updated);

      expect(result.unchanged).toHaveLength(2);
      expect(findByKey(result.unchanged, 'my-notes')?.content).toContain('Personal stuff');
    });
  });

  describe('empty files', () => {
    it('handles all empty strings', () => {
      const result = computeSectionMerge('', '', '');

      expect(result.unchanged).toHaveLength(0);
      expect(result.autoMerged).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('handles empty base and local with new content', () => {
      const updated = md('# Setup', 'New content');
      const result = computeSectionMerge('', '', updated);

      expect(result.autoMerged).toHaveLength(1);
      expect(result.autoMerged[0].source).toBe('added');
    });

    it('handles empty new (all sections removed)', () => {
      const content = md('# Setup', 'Content');
      const result = computeSectionMerge(content, content, '');

      expect(result.removed).toHaveLength(1);
    });
  });

  describe('frontmatter handling', () => {
    it('handles files with only frontmatter', () => {
      const fm = md('---', 'title: Test', '---');
      const result = computeSectionMerge(fm, fm, fm);

      expect(result.unchanged).toHaveLength(1);
      expect(result.unchanged[0].key).toBe('_frontmatter');
    });

    it('detects frontmatter changes as auto-merge', () => {
      const baseFm = md('---', 'title: Old', '---', '', '# Content', 'Body');
      const localFm = baseFm;
      const newFm = md('---', 'title: New', '---', '', '# Content', 'Body');

      const result = computeSectionMerge(baseFm, localFm, newFm);

      expect(result.autoMerged).toHaveLength(1);
      expect(result.autoMerged[0].key).toBe('_frontmatter');
      expect(result.autoMerged[0].source).toBe('new');
    });

    it('flags frontmatter conflict when both changed', () => {
      const base = md('---', 'title: Base', '---');
      const local = md('---', 'title: Local', '---');
      const updated = md('---', 'title: New', '---');

      const result = computeSectionMerge(base, local, updated);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe('_frontmatter');
    });
  });

  describe('multiple conflicts', () => {
    it('reports multiple conflicts in one file', () => {
      const base = md('# A', 'Base A', '', '# B', 'Base B', '', '# C', 'Base C');
      const local = md('# A', 'Local A', '', '# B', 'Local B', '', '# C', 'Base C');
      const updated = md('# A', 'New A', '', '# B', 'New B', '', '# C', 'New C');

      const result = computeSectionMerge(base, local, updated);

      expect(result.conflicts).toHaveLength(2);
      expect(result.conflicts.map((c) => c.key)).toEqual(['a', 'b']);

      // C: local unchanged, new changed → auto-merge
      expect(result.autoMerged).toHaveLength(1);
      expect(result.autoMerged[0].key).toBe('c');
    });
  });

  describe('nested sections', () => {
    it('handles hierarchical section keys correctly', () => {
      const base = md('# Setup', 'Intro', '', '## Prerequisites', 'Node 18+');
      const local = base;
      const updated = md('# Setup', 'Intro', '', '## Prerequisites', 'Node 20+');

      const result = computeSectionMerge(base, local, updated);

      expect(result.autoMerged).toHaveLength(1);
      expect(result.autoMerged[0].key).toBe('setup/prerequisites');
    });
  });

  describe('preamble handling', () => {
    it('handles preamble content before first heading', () => {
      const base = md('Some intro text', '', '# Setup', 'Content');
      const local = md('Modified intro', '', '# Setup', 'Content');
      const updated = base;

      const result = computeSectionMerge(base, local, updated);

      // Preamble changed locally, not in new → keep local
      expect(findByKey(result.unchanged, '_preamble')?.content).toContain('Modified intro');
    });
  });

  describe('edge cases', () => {
    it('handles section deleted locally but updated in new as conflict', () => {
      const base = md('# Setup', 'Install deps', '', '# Config', 'Old config');
      const local = md('# Setup', 'Install deps'); // user removed Config
      const updated = md('# Setup', 'Install deps', '', '# Config', 'New config');

      const result = computeSectionMerge(base, local, updated);

      // Config was deleted locally but updated in new → conflict
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe('config');
      expect(result.conflicts[0].localContent).toBe('');
      expect(result.conflicts[0].newContent).toContain('New config');
    });

    it('handles section deleted locally and unchanged in new (no action)', () => {
      const base = md('# Setup', 'Install deps', '', '# Config', 'Old config');
      const local = md('# Setup', 'Install deps'); // user removed Config
      const updated = base; // template unchanged

      const result = computeSectionMerge(base, local, updated);

      // User intentionally removed it, template didn't change it → respect removal
      expect(result.conflicts).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
    });

    it('handles both local and new adding the same key with different content', () => {
      const base = md('# Existing', 'Content');
      const local = md('# Existing', 'Content', '', '# New Section', 'Local version');
      const updated = md('# Existing', 'Content', '', '# New Section', 'Template version');

      const result = computeSectionMerge(base, local, updated);

      // Both added "new-section" with different content → conflict
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe('new-section');
    });

    it('handles both local and new adding the same key with identical content', () => {
      const base = md('# Existing', 'Content');
      const local = md('# Existing', 'Content', '', '# New Section', 'Same content');
      const updated = md('# Existing', 'Content', '', '# New Section', 'Same content');

      const result = computeSectionMerge(base, local, updated);

      expect(result.conflicts).toHaveLength(0);
      expect(findByKey(result.unchanged, 'new-section')).toBeDefined();
    });
  });
});
