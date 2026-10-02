import { describe, it, expect } from 'vitest';
import { normalizeToMarkdown, type ContentFormat } from '../normalize';

describe('normalizeToMarkdown', () => {
  // -------------------------------------------------------------------------
  // Markdown passthrough
  // -------------------------------------------------------------------------

  describe('markdown format', () => {
    it('returns cleaned markdown unchanged', () => {
      const input = '# Hello\n\nSome **bold** text.';
      expect(normalizeToMarkdown(input, 'markdown')).toBe(input);
    });

    it('collapses excessive newlines', () => {
      const input = '# Hello\n\n\n\n\nParagraph';
      expect(normalizeToMarkdown(input, 'markdown')).toBe('# Hello\n\nParagraph');
    });

    it('trims trailing spaces on lines', () => {
      const input = 'Line one   \nLine two  ';
      const result = normalizeToMarkdown(input, 'markdown');
      expect(result).toBe('Line one\nLine two');
    });
  });

  // -------------------------------------------------------------------------
  // HTML -> Markdown
  // -------------------------------------------------------------------------

  describe('html format', () => {
    it('converts headings', () => {
      const result = normalizeToMarkdown('<h1>Title</h1><h2>Sub</h2>', 'html');
      expect(result).toContain('# Title');
      expect(result).toContain('## Sub');
    });

    it('converts paragraphs', () => {
      const result = normalizeToMarkdown('<p>Hello world</p>', 'html');
      expect(result).toContain('Hello world');
    });

    it('converts bold and italic', () => {
      const result = normalizeToMarkdown(
        '<p><strong>bold</strong> and <em>italic</em></p>',
        'html',
      );
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
    });

    it('converts inline code', () => {
      const result = normalizeToMarkdown('<p>Use <code>npm install</code></p>', 'html');
      expect(result).toContain('`npm install`');
    });

    it('converts code blocks', () => {
      const result = normalizeToMarkdown(
        '<pre><code class="language-js">const x = 1;</code></pre>',
        'html',
      );
      expect(result).toContain('```js');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('```');
    });

    it('converts unordered lists', () => {
      const result = normalizeToMarkdown('<ul><li>One</li><li>Two</li></ul>', 'html');
      expect(result).toContain('- One');
      expect(result).toContain('- Two');
    });

    it('converts ordered lists', () => {
      const result = normalizeToMarkdown('<ol><li>First</li><li>Second</li></ol>', 'html');
      expect(result).toContain('1. First');
      expect(result).toContain('2. Second');
    });

    it('converts links', () => {
      const result = normalizeToMarkdown('<a href="https://example.com">Click</a>', 'html');
      expect(result).toContain('[Click](https://example.com)');
    });

    it('converts images', () => {
      const result = normalizeToMarkdown('<img src="pic.png" alt="A picture" />', 'html');
      expect(result).toContain('![A picture](pic.png)');
    });

    it('converts blockquotes', () => {
      const result = normalizeToMarkdown('<blockquote>Quote text</blockquote>', 'html');
      expect(result).toContain('> Quote text');
    });

    it('converts horizontal rules', () => {
      const result = normalizeToMarkdown('<hr />', 'html');
      expect(result).toContain('---');
    });

    it('converts tables', () => {
      const result = normalizeToMarkdown(
        '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>',
        'html',
      );
      expect(result).toContain('| Name | Age |');
      expect(result).toContain('| --- | --- |');
      expect(result).toContain('| Alice | 30 |');
    });

    it('strips scripts and styles', () => {
      const result = normalizeToMarkdown(
        '<script>alert("xss")</script><style>.x{}</style><p>Clean</p>',
        'html',
      );
      expect(result).not.toContain('alert');
      expect(result).not.toContain('.x{}');
      expect(result).toContain('Clean');
    });

    it('strips nav, footer, header, iframe', () => {
      const result = normalizeToMarkdown(
        '<nav>Nav</nav><footer>Foot</footer><header>Head</header><p>Content</p>',
        'html',
      );
      expect(result).not.toContain('Nav');
      expect(result).not.toContain('Foot');
      expect(result).not.toContain('Head');
      expect(result).toContain('Content');
    });
  });

  // -------------------------------------------------------------------------
  // Text -> Markdown
  // -------------------------------------------------------------------------

  describe('text format', () => {
    it('passes through plain text cleaned', () => {
      const result = normalizeToMarkdown('Hello world\n\n\n\nParagraph', 'text');
      expect(result).toBe('Hello world\n\nParagraph');
    });
  });

  // -------------------------------------------------------------------------
  // Notion blocks -> Markdown
  // -------------------------------------------------------------------------

  describe('notion_blocks format', () => {
    it('converts headings', () => {
      const blocks = JSON.stringify([
        { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Title' }] } },
        { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Subtitle' }] } },
      ]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('# Title');
      expect(result).toContain('## Subtitle');
    });

    it('converts paragraphs', () => {
      const blocks = JSON.stringify([
        { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello' }] } },
      ]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('Hello');
    });

    it('converts bulleted list items', () => {
      const blocks = JSON.stringify([
        {
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ plain_text: 'Item one' }] },
        },
      ]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('- Item one');
    });

    it('converts to-do items', () => {
      const blocks = JSON.stringify([
        { type: 'to_do', to_do: { rich_text: [{ plain_text: 'Task' }], checked: true } },
      ]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('- [x] Task');
    });

    it('converts code blocks with language', () => {
      const blocks = JSON.stringify([
        {
          type: 'code',
          code: { rich_text: [{ plain_text: 'const x = 1;' }], language: 'typescript' },
        },
      ]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('```typescript');
      expect(result).toContain('const x = 1;');
    });

    it('handles rich text annotations', () => {
      const blocks = JSON.stringify([
        {
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { plain_text: 'bold', annotations: { bold: true } },
              { plain_text: ' and ' },
              { plain_text: 'italic', annotations: { italic: true } },
            ],
          },
        },
      ]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
    });

    it('falls back to cleaned string on invalid JSON', () => {
      const result = normalizeToMarkdown('not json', 'notion_blocks');
      expect(result).toBe('not json');
    });

    it('converts dividers', () => {
      const blocks = JSON.stringify([{ type: 'divider' }]);
      const result = normalizeToMarkdown(blocks, 'notion_blocks');
      expect(result).toContain('---');
    });
  });

  // -------------------------------------------------------------------------
  // Confluence ADF -> Markdown
  // -------------------------------------------------------------------------

  describe('confluence_adf format', () => {
    it('converts document with heading and paragraph', () => {
      const adf = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Overview' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Introduction text.' }],
          },
        ],
      });
      const result = normalizeToMarkdown(adf, 'confluence_adf');
      expect(result).toContain('## Overview');
      expect(result).toContain('Introduction text.');
    });

    it('converts text marks (bold, italic, code)', () => {
      const adf = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'italic', marks: [{ type: 'em' }] },
              { type: 'text', text: ' ' },
              { type: 'text', text: 'code', marks: [{ type: 'code' }] },
            ],
          },
        ],
      });
      const result = normalizeToMarkdown(adf, 'confluence_adf');
      expect(result).toContain('**bold**');
      expect(result).toContain('*italic*');
      expect(result).toContain('`code`');
    });

    it('converts bullet lists', () => {
      const adf = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [{ type: 'text', text: 'Item A' }] },
              { type: 'listItem', content: [{ type: 'text', text: 'Item B' }] },
            ],
          },
        ],
      });
      const result = normalizeToMarkdown(adf, 'confluence_adf');
      expect(result).toContain('- Item A');
      expect(result).toContain('- Item B');
    });

    it('converts code blocks', () => {
      const adf = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'python' },
            content: [{ type: 'text', text: 'print("hello")' }],
          },
        ],
      });
      const result = normalizeToMarkdown(adf, 'confluence_adf');
      expect(result).toContain('```python');
      expect(result).toContain('print("hello")');
    });

    it('converts rules (horizontal dividers)', () => {
      const adf = JSON.stringify({
        type: 'doc',
        content: [{ type: 'rule' }],
      });
      const result = normalizeToMarkdown(adf, 'confluence_adf');
      expect(result).toContain('---');
    });

    it('falls back to cleaned string on invalid JSON', () => {
      const result = normalizeToMarkdown('bad json', 'confluence_adf');
      expect(result).toBe('bad json');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown format defaults to markdown cleanup
  // -------------------------------------------------------------------------

  it('defaults to markdown cleanup for unknown format', () => {
    const result = normalizeToMarkdown('Hello\n\n\n\n', 'unknown' as ContentFormat);
    expect(result).toBe('Hello');
  });
});
