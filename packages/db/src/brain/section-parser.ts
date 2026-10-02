/**
 * Markdown Section Parser
 *
 * Splits markdown files into discrete sections based on heading hierarchy (H1-H4).
 * Each section becomes an independently trackable unit with its own content hash.
 * Used by the brain merge system for per-section fork detection and updates.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainSection {
  /** Slug key, e.g. "setup" or "setup/prerequisites". "_preamble" for content before first heading, "_frontmatter" for YAML frontmatter. */
  key: string;
  /** Original heading text (without # prefix). Empty string for preamble/frontmatter. */
  heading: string;
  /** Heading level (1-4). 0 for preamble/frontmatter. */
  level: number;
  /** Raw content of the section (includes the heading line itself for headed sections). */
  content: string;
  /** SHA-256 hex hash of the content. */
  hash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify a heading: lowercase, spaces to hyphens, strip non-alphanumeric (except hyphens). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Compute SHA-256 hex hash — matches computeContentHash in brain-manifest-registry.ts. */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// Matches lines like "# Heading", "## Heading", up to "####"
const HEADING_RE = /^(#{1,4})\s+(.+)$/;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse markdown content into an array of BrainSection objects.
 *
 * Splitting rules:
 * - YAML frontmatter (between opening and closing `---`) becomes `_frontmatter`.
 * - Content before the first heading becomes `_preamble`.
 * - Each heading (H1-H4) starts a new section.
 * - Nested headings produce hierarchical keys: `parent/child`.
 */
export function parseSections(content: string): BrainSection[] {
  const sections: BrainSection[] = [];
  let remaining = content;

  // --- Frontmatter extraction ---
  if (remaining.startsWith('---\n') || remaining.startsWith('---\r\n')) {
    const lineEnd = remaining.indexOf('\n') + 1; // skip first ---
    const closingIdx = remaining.indexOf('\n---', lineEnd);
    if (closingIdx !== -1) {
      // Find the end of the closing --- line
      let fmEnd = remaining.indexOf('\n', closingIdx + 1);
      if (fmEnd === -1) fmEnd = remaining.length;
      else fmEnd += 1; // include the newline

      const fmContent = remaining.slice(0, fmEnd);
      sections.push({
        key: '_frontmatter',
        heading: '',
        level: 0,
        content: fmContent,
        hash: hashContent(fmContent),
      });
      remaining = remaining.slice(fmEnd);
    }
  }

  // --- Split remaining content by heading lines ---
  const lines = remaining.split('\n');

  // Track parent headings for nested key generation.
  // Index 1-4 holds the most recent slug at that heading level.
  const parentStack: (string | null)[] = [null, null, null, null, null];

  let currentLines: string[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let currentKey = '_preamble';
  let inPreamble = true;

  function flushSection() {
    const raw = currentLines.join('\n');
    // Only emit if there is non-whitespace content
    if (raw.trim().length === 0) return;
    sections.push({
      key: currentKey,
      heading: currentHeading,
      level: currentLevel,
      content: raw,
      hash: hashContent(raw),
    });
  }

  for (const line of lines) {
    const match = line.match(HEADING_RE);
    if (match) {
      // Flush previous section
      flushSection();

      const level = match[1].length;
      const headingText = match[2].trim();
      const slug = slugify(headingText);

      // Update parent stack
      parentStack[level] = slug;
      // Clear deeper levels
      for (let i = level + 1; i <= 4; i++) parentStack[i] = null;

      // Build hierarchical key
      const keyParts: string[] = [];
      for (let i = 1; i < level; i++) {
        if (parentStack[i]) keyParts.push(parentStack[i]!);
      }
      keyParts.push(slug);

      currentKey = keyParts.join('/');
      currentHeading = headingText;
      currentLevel = level;
      currentLines = [line];
      inPreamble = false;
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  flushSection();

  return sections;
}
