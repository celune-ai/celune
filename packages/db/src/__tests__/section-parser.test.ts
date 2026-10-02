import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { parseSections, slugify } from '../brain/section-parser';
import type { BrainSection } from '../brain/section-parser';

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Setup & Config!')).toBe('setup-config');
    expect(slugify('A / B')).toBe('a-b');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('one---two')).toBe('one-two');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseSections — basic
// ---------------------------------------------------------------------------

describe('parseSections', () => {
  it('returns empty array for empty content', () => {
    expect(parseSections('')).toEqual([]);
  });

  it('returns empty array for whitespace-only content', () => {
    expect(parseSections('   \n\n  ')).toEqual([]);
  });

  it('parses a single heading section', () => {
    const md = '## Setup\nInstall deps with pnpm.';
    const result = parseSections(md);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('setup');
    expect(result[0].heading).toBe('Setup');
    expect(result[0].level).toBe(2);
    expect(result[0].content).toBe(md);
    expect(result[0].hash).toBe(sha256(md));
  });

  it('splits multiple H2 sections', () => {
    const md = '## First\nContent A\n## Second\nContent B';
    const result = parseSections(md);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('first');
    expect(result[0].content).toBe('## First\nContent A');
    expect(result[1].key).toBe('second');
    expect(result[1].content).toBe('## Second\nContent B');
  });

  // ---------------------------------------------------------------------------
  // Preamble
  // ---------------------------------------------------------------------------

  it('captures content before first heading as _preamble', () => {
    const md = 'Some intro text.\n\n## Heading\nBody';
    const result = parseSections(md);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('_preamble');
    expect(result[0].heading).toBe('');
    expect(result[0].level).toBe(0);
    expect(result[0].content).toBe('Some intro text.\n');
    expect(result[1].key).toBe('heading');
  });

  // ---------------------------------------------------------------------------
  // Frontmatter
  // ---------------------------------------------------------------------------

  it('extracts YAML frontmatter as _frontmatter', () => {
    const md = '---\ntitle: Test\n---\n## Heading\nBody';
    const result = parseSections(md);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('_frontmatter');
    expect(result[0].content).toBe('---\ntitle: Test\n---\n');
    expect(result[0].level).toBe(0);
    expect(result[1].key).toBe('heading');
  });

  it('handles frontmatter + preamble + heading', () => {
    const md = '---\ntitle: Doc\n---\nSome preamble.\n## Section\nContent';
    const result = parseSections(md);
    expect(result).toHaveLength(3);
    expect(result[0].key).toBe('_frontmatter');
    expect(result[1].key).toBe('_preamble');
    expect(result[2].key).toBe('section');
  });

  // ---------------------------------------------------------------------------
  // Nested headings
  // ---------------------------------------------------------------------------

  it('creates hierarchical keys for nested headings', () => {
    const md = '## Setup\nIntro\n### Prerequisites\nNode 20+\n### Installation\npnpm install';
    const result = parseSections(md);
    expect(result).toHaveLength(3);
    expect(result[0].key).toBe('setup');
    expect(result[1].key).toBe('setup/prerequisites');
    expect(result[2].key).toBe('setup/installation');
  });

  it('handles H1 > H2 > H3 > H4 nesting', () => {
    const md = ['# Top', 'A', '## Mid', 'B', '### Deep', 'C', '#### Deepest', 'D'].join('\n');
    const result = parseSections(md);
    expect(result).toHaveLength(4);
    expect(result[0].key).toBe('top');
    expect(result[1].key).toBe('top/mid');
    expect(result[2].key).toBe('top/mid/deep');
    expect(result[3].key).toBe('top/mid/deep/deepest');
  });

  it('resets deeper levels when a same-or-higher heading appears', () => {
    const md = ['## Setup', 'A', '### Sub', 'B', '## Usage', 'C', '### Sub', 'D'].join('\n');
    const result = parseSections(md);
    expect(result).toHaveLength(4);
    expect(result[0].key).toBe('setup');
    expect(result[1].key).toBe('setup/sub');
    expect(result[2].key).toBe('usage');
    expect(result[3].key).toBe('usage/sub');
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('ignores H5+ headings (treats as content)', () => {
    const md = '## Main\nContent\n##### Too deep\nMore content';
    const result = parseSections(md);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('main');
    expect(result[0].content).toContain('##### Too deep');
  });

  it('handles empty sections (heading with no body)', () => {
    const md = '## Empty\n## Next\nHas content';
    const result = parseSections(md);
    // "## Empty" alone is just the heading line — has content (the line itself)
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('empty');
    expect(result[0].content).toBe('## Empty');
    expect(result[1].key).toBe('next');
  });

  it('computes unique hashes per section', () => {
    const md = '## A\nContent A\n## B\nContent B';
    const result = parseSections(md);
    expect(result[0].hash).not.toBe(result[1].hash);
  });

  it('computes same hash for identical content', () => {
    const md1 = '## Test\nHello';
    const md2 = '## Test\nHello';
    const r1 = parseSections(md1);
    const r2 = parseSections(md2);
    expect(r1[0].hash).toBe(r2[0].hash);
  });

  it('handles content with no headings at all (all preamble)', () => {
    const md = 'Just plain text\nwith multiple lines.';
    const result = parseSections(md);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('_preamble');
    expect(result[0].content).toBe(md);
  });

  it('handles headings with special characters', () => {
    const md = '## Setup & Config (v2.0)\nContent';
    const result = parseSections(md);
    expect(result[0].key).toBe('setup-config-v20');
    expect(result[0].heading).toBe('Setup & Config (v2.0)');
  });
});
