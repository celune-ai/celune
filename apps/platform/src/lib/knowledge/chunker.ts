export interface Chunk {
  content: string;
  title: string | null;
  chunkIndex: number;
  charCount: number;
}

export interface ChunkOptions {
  /** Max characters per chunk (~4000 chars = ~1000 tokens). Default: 4000 */
  maxChunkChars?: number;
  /** Min characters per chunk (~200 chars = ~50 tokens). Default: 200 */
  minChunkChars?: number;
}

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MIN_CHARS = 200;

/**
 * Split markdown content into semantically meaningful chunks.
 *
 * Strategy:
 * 1. Split by headings (##, ###) first
 * 2. If a section exceeds maxChunkChars, split by paragraphs
 * 3. Merge small chunks with their neighbors
 * 4. Never split inside code blocks
 */
export function chunkContent(markdown: string, options?: ChunkOptions): Chunk[] {
  const maxChars = options?.maxChunkChars ?? DEFAULT_MAX_CHARS;
  const minChars = options?.minChunkChars ?? DEFAULT_MIN_CHARS;

  if (!markdown.trim()) return [];

  // Step 1: Split by headings while preserving code blocks
  const sections = splitByHeadings(markdown);

  // Step 2: Break oversized sections by paragraph
  const sized: Array<{ title: string | null; content: string }> = [];
  for (const section of sections) {
    if (section.content.length <= maxChars) {
      sized.push(section);
    } else {
      const sub = splitByParagraphs(section.content, section.title, maxChars);
      sized.push(...sub);
    }
  }

  // Step 3: Merge undersized chunks with neighbors
  const merged = mergeSmallChunks(sized, minChars, maxChars);

  // Step 4: Build final Chunk array
  return merged
    .map((s, i) => ({
      content: s.content.trim(),
      title: s.title,
      chunkIndex: i,
      charCount: s.content.trim().length,
    }))
    .filter((c) => c.charCount > 0);
}

// ---------------------------------------------------------------------------
// Heading-based splitting
// ---------------------------------------------------------------------------

interface Section {
  title: string | null;
  content: string;
}

function splitByHeadings(markdown: string): Section[] {
  // Protect code blocks by replacing them with placeholders
  const codeBlocks: string[] = [];
  const protected_ = markdown.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  // Split on ## or ### headings (not # — that's usually the doc title)
  const headingPattern = /^(#{2,3})\s+(.+)$/gm;
  const parts: Section[] = [];
  let lastIndex = 0;
  let lastTitle: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(protected_)) !== null) {
    const before = protected_.slice(lastIndex, match.index);
    if (before.trim()) {
      parts.push({ title: lastTitle, content: restoreCodeBlocks(before, codeBlocks) });
    }
    lastTitle = match[2]!.trim();
    lastIndex = match.index + match[0].length;
  }

  // Remaining content after last heading
  const remaining = protected_.slice(lastIndex);
  if (remaining.trim()) {
    parts.push({ title: lastTitle, content: restoreCodeBlocks(remaining, codeBlocks) });
  }

  // If no headings found, return entire content as one section
  if (parts.length === 0) {
    parts.push({ title: null, content: markdown });
  }

  return parts;
}

function restoreCodeBlocks(text: string, codeBlocks: string[]): string {
  return text.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[parseInt(idx)]!);
}

// ---------------------------------------------------------------------------
// Paragraph-based splitting for oversized sections
// ---------------------------------------------------------------------------

function splitByParagraphs(content: string, title: string | null, maxChars: number): Section[] {
  // Protect code blocks
  const codeBlocks: string[] = [];
  const protected_ = content.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  const paragraphs = protected_.split(/\n\n+/);
  const sections: Section[] = [];
  let current = '';

  for (const para of paragraphs) {
    const restored = restoreCodeBlocks(para, codeBlocks);
    if (current.length + restored.length + 2 > maxChars && current.length > 0) {
      sections.push({ title, content: current.trim() });
      current = restored;
    } else {
      current += (current ? '\n\n' : '') + restored;
    }
  }

  if (current.trim()) {
    sections.push({ title, content: current.trim() });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Merge small chunks
// ---------------------------------------------------------------------------

function mergeSmallChunks(sections: Section[], minChars: number, maxChars: number): Section[] {
  if (sections.length <= 1) return sections;

  const result: Section[] = [];

  for (const section of sections) {
    const last = result[result.length - 1];
    if (
      last &&
      last.content.length < minChars &&
      last.content.length + section.content.length + 2 <= maxChars
    ) {
      // Merge into previous
      last.content += '\n\n' + section.content;
      // Keep the more specific title
      if (!last.title && section.title) last.title = section.title;
    } else if (
      section.content.length < minChars &&
      last &&
      last.content.length + section.content.length + 2 <= maxChars
    ) {
      // Small chunk — merge into previous if it fits
      last.content += '\n\n' + section.content;
      if (!last.title && section.title) last.title = section.title;
    } else {
      result.push({ ...section });
    }
  }

  return result;
}
