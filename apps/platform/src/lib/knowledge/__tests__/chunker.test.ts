import { describe, it, expect } from 'vitest';
import { chunkContent, type Chunk } from '../chunker';

describe('chunkContent', () => {
  it('returns empty array for empty input', () => {
    expect(chunkContent('')).toEqual([]);
    expect(chunkContent('   ')).toEqual([]);
  });

  it('returns single chunk for short content', () => {
    const result = chunkContent('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('Hello world');
    expect(result[0]!.chunkIndex).toBe(0);
    expect(result[0]!.charCount).toBe(11);
  });

  it('preserves title as null when no headings', () => {
    const result = chunkContent('Just a paragraph');
    expect(result[0]!.title).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Heading-based splitting
  // -------------------------------------------------------------------------

  it('splits by ## headings', () => {
    // Use long-enough sections to avoid merging (minChunkChars = 200)
    const longContent = 'Lorem ipsum dolor sit amet. '.repeat(15);
    const md = `# Doc Title

Intro paragraph.

## Section One

${longContent}

## Section Two

${longContent}`;

    const result = chunkContent(md);
    expect(result.length).toBeGreaterThanOrEqual(2);

    const titles = result.map((c) => c.title);
    expect(titles).toContain('Section One');
    expect(titles).toContain('Section Two');
  });

  it('splits by ### headings', () => {
    const longContent = 'Lorem ipsum dolor sit amet. '.repeat(15);
    const md = `### Sub A

${longContent}

### Sub B

${longContent}`;

    const result = chunkContent(md);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns correct chunk indices', () => {
    const md = `## A\n\nText\n\n## B\n\nText\n\n## C\n\nText`;
    const result = chunkContent(md);
    result.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  // -------------------------------------------------------------------------
  // Code block preservation
  // -------------------------------------------------------------------------

  it('does not split inside code blocks', () => {
    const md = `## Section

\`\`\`javascript
// This has ## fake heading inside code
function foo() {
  return "## not a heading";
}
\`\`\`

After code.`;

    const result = chunkContent(md);
    // Should be one chunk since the ## inside code is not a real heading
    const codeChunk = result.find((c) => c.content.includes('fake heading'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain('function foo()');
  });

  // -------------------------------------------------------------------------
  // Oversized section splitting by paragraph
  // -------------------------------------------------------------------------

  it('splits oversized sections by paragraph', () => {
    const longParagraph = 'A'.repeat(2000);
    const md = `## Big Section\n\n${longParagraph}\n\n${longParagraph}\n\n${longParagraph}`;

    const result = chunkContent(md, { maxChunkChars: 3000 });
    expect(result.length).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // Small chunk merging
  // -------------------------------------------------------------------------

  it('merges small chunks with neighbors', () => {
    const md = `## A\n\nTiny.\n\n## B\n\nAlso tiny.`;
    const result = chunkContent(md, { minChunkChars: 500 });
    // Both sections are under 500 chars, should be merged
    expect(result).toHaveLength(1);
  });

  it('does not merge when combined would exceed max', () => {
    const text1 = 'A'.repeat(3000);
    const text2 = 'B'.repeat(3000);
    const md = `## A\n\n${text1}\n\n## B\n\n${text2}`;
    const result = chunkContent(md, { maxChunkChars: 4000, minChunkChars: 200 });
    expect(result.length).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // charCount accuracy
  // -------------------------------------------------------------------------

  it('charCount matches trimmed content length', () => {
    const md = '## Test\n\nHello world.';
    const result = chunkContent(md);
    for (const chunk of result) {
      expect(chunk.charCount).toBe(chunk.content.length);
    }
  });

  // -------------------------------------------------------------------------
  // Custom options
  // -------------------------------------------------------------------------

  it('respects custom maxChunkChars with headings', () => {
    const longContent = 'Word '.repeat(200);
    const md = `## Section A\n\n${longContent}\n\n## Section B\n\n${longContent}`;
    const result = chunkContent(md, { maxChunkChars: 500 });
    // With headings + long content, should split into multiple chunks
    expect(result.length).toBeGreaterThan(1);
  });
});
