import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// DOM node types — cheerio v1.2 uses domhandler internally but doesn't
// re-export its types. We define structural equivalents here.
// ---------------------------------------------------------------------------

interface DomText {
  type: 'text';
  data: string;
}

interface DomElement {
  type: 'tag' | 'script' | 'style';
  tagName: string;
  childNodes: DomNode[];
  parentNode: DomElement | null;
}

type DomNode = DomText | DomElement | { type: string };

export type ContentFormat = 'markdown' | 'html' | 'text' | 'notion_blocks' | 'confluence_adf';

/**
 * Normalize content from various formats into clean markdown.
 */
export function normalizeToMarkdown(content: string, format: ContentFormat): string {
  switch (format) {
    case 'markdown':
      return cleanMarkdown(content);
    case 'html':
      return htmlToMarkdown(content);
    case 'text':
      return textToMarkdown(content);
    case 'notion_blocks':
      return notionBlocksToMarkdown(content);
    case 'confluence_adf':
      return confluenceAdfToMarkdown(content);
    default:
      return cleanMarkdown(content);
  }
}

// ---------------------------------------------------------------------------
// HTML -> Markdown (using cheerio)
// ---------------------------------------------------------------------------

function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts, styles, and non-content elements
  $('script, style, nav, footer, header, iframe, noscript').remove();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function processNode(el: any): string {
    if (el.type === 'text') {
      return (el as DomText).data || '';
    }
    if (el.type !== 'tag' && el.type !== 'script' && el.type !== 'style') return '';

    const tag = (el as DomElement).tagName?.toLowerCase();
    const children = (el as DomElement).childNodes || [];
    const inner = children.map(processNode).join('');

    switch (tag) {
      case 'h1':
        return `\n# ${inner.trim()}\n\n`;
      case 'h2':
        return `\n## ${inner.trim()}\n\n`;
      case 'h3':
        return `\n### ${inner.trim()}\n\n`;
      case 'h4':
        return `\n#### ${inner.trim()}\n\n`;
      case 'h5':
        return `\n##### ${inner.trim()}\n\n`;
      case 'h6':
        return `\n###### ${inner.trim()}\n\n`;
      case 'p':
        return `\n${inner.trim()}\n\n`;
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `**${inner.trim()}**`;
      case 'em':
      case 'i':
        return `*${inner.trim()}*`;
      case 'code':
        return `\`${inner.trim()}\``;
      case 'pre': {
        const codeEl = $(el).find('code');
        const codeText = codeEl.length ? codeEl.text() : inner;
        const lang = codeEl.attr('class')?.match(/language-(\w+)/)?.[1] || '';
        return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
      }
      case 'blockquote':
        return (
          '\n' +
          inner
            .trim()
            .split('\n')
            .map((line: string) => `> ${line}`)
            .join('\n') +
          '\n\n'
        );
      case 'ul':
        return '\n' + inner + '\n';
      case 'ol':
        return '\n' + inner + '\n';
      case 'li': {
        const parent = (el as DomElement).parentNode as DomElement | undefined;
        const parentTag = parent?.tagName?.toLowerCase();
        if (parentTag === 'ol') {
          const siblings = $(el).parent().children('li');
          const idx = siblings.index(el) + 1;
          return `${idx}. ${inner.trim()}\n`;
        }
        return `- ${inner.trim()}\n`;
      }
      case 'a': {
        const href = $(el).attr('href') || '';
        return href ? `[${inner.trim()}](${href})` : inner;
      }
      case 'img': {
        const src = $(el).attr('src') || '';
        const alt = $(el).attr('alt') || '';
        return `![${alt}](${src})`;
      }
      case 'hr':
        return '\n---\n\n';
      case 'table':
        return '\n' + processTable($, el) + '\n';
      case 'div':
      case 'span':
      case 'section':
      case 'article':
      case 'main':
        return inner;
      default:
        return inner;
    }
  }

  const body = $('body').length ? $('body')[0]! : $.root()[0]!;
  const raw = processNode(body);
  return cleanMarkdown(raw);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processTable($: cheerio.CheerioAPI, tableEl: any): string {
  const rows: string[][] = [];
  $(tableEl)
    .find('tr')
    .each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .find('th, td')
        .each((__, cell) => {
          cells.push($(cell).text().trim());
        });
      if (cells.length > 0) rows.push(cells);
    });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    while (r.length < colCount) r.push('');
    return r;
  });

  const lines: string[] = [];
  lines.push('| ' + padded[0]!.join(' | ') + ' |');
  lines.push('| ' + padded[0]!.map(() => '---').join(' | ') + ' |');
  for (let i = 1; i < padded.length; i++) {
    lines.push('| ' + padded[i]!.join(' | ') + ' |');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plain text -> Markdown
// ---------------------------------------------------------------------------

function textToMarkdown(text: string): string {
  return cleanMarkdown(text);
}

// ---------------------------------------------------------------------------
// Notion blocks -> Markdown (JSON string of block array)
// ---------------------------------------------------------------------------

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

interface NotionRichText {
  plain_text?: string;
  text?: { content?: string };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
  };
}

function richTextToMd(richTexts: NotionRichText[] | undefined): string {
  if (!richTexts || !Array.isArray(richTexts)) return '';
  return richTexts
    .map((rt) => {
      let text = rt.plain_text || rt.text?.content || '';
      if (rt.annotations?.bold) text = `**${text}**`;
      if (rt.annotations?.italic) text = `*${text}*`;
      if (rt.annotations?.code) text = `\`${text}\``;
      if (rt.annotations?.strikethrough) text = `~~${text}~~`;
      return text;
    })
    .join('');
}

function notionBlocksToMarkdown(jsonStr: string): string {
  let blocks: NotionBlock[];
  try {
    blocks = JSON.parse(jsonStr);
  } catch {
    return cleanMarkdown(jsonStr);
  }

  if (!Array.isArray(blocks)) return cleanMarkdown(jsonStr);

  const lines: string[] = [];

  for (const block of blocks) {
    const data = block[block.type] as
      | {
          rich_text?: NotionRichText[];
          language?: string;
          checked?: boolean;
          children?: NotionBlock[];
        }
      | undefined;
    const text = richTextToMd(data?.rich_text);

    switch (block.type) {
      case 'heading_1':
        lines.push(`# ${text}`);
        break;
      case 'heading_2':
        lines.push(`## ${text}`);
        break;
      case 'heading_3':
        lines.push(`### ${text}`);
        break;
      case 'paragraph':
        lines.push(text);
        break;
      case 'code':
        lines.push(`\`\`\`${data?.language || ''}\n${text}\n\`\`\``);
        break;
      case 'bulleted_list_item':
        lines.push(`- ${text}`);
        break;
      case 'numbered_list_item':
        lines.push(`1. ${text}`);
        break;
      case 'to_do':
        lines.push(`- [${data?.checked ? 'x' : ' '}] ${text}`);
        break;
      case 'toggle':
        lines.push(`<details><summary>${text}</summary>\n</details>`);
        break;
      case 'callout':
        lines.push(`> ${text}`);
        break;
      case 'quote':
        lines.push(
          text
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n'),
        );
        break;
      case 'divider':
        lines.push('---');
        break;
      case 'table': {
        const rows = data?.children as NotionBlock[] | undefined;
        if (rows && Array.isArray(rows)) {
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i] as { table_row?: { cells?: NotionRichText[][] } };
            const cells = row?.table_row?.cells || [];
            const cellTexts = cells.map((c) => richTextToMd(c));
            lines.push('| ' + cellTexts.join(' | ') + ' |');
            if (i === 0) {
              lines.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |');
            }
          }
        }
        break;
      }
      default:
        if (text) lines.push(text);
        break;
    }
  }

  return cleanMarkdown(lines.join('\n\n'));
}

// ---------------------------------------------------------------------------
// Confluence ADF -> Markdown (JSON string)
// ---------------------------------------------------------------------------

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string }>;
}

function confluenceAdfToMarkdown(jsonStr: string): string {
  let doc: AdfNode;
  try {
    doc = JSON.parse(jsonStr);
  } catch {
    return cleanMarkdown(jsonStr);
  }

  function processAdf(node: AdfNode): string {
    if (node.type === 'text') {
      let t = node.text || '';
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'strong') t = `**${t}**`;
          if (mark.type === 'em') t = `*${t}*`;
          if (mark.type === 'code') t = `\`${t}\``;
        }
      }
      return t;
    }

    const children = (node.content || []).map(processAdf).join('');

    switch (node.type) {
      case 'doc':
        return children;
      case 'heading': {
        const level = (node.attrs?.level as number) || 1;
        return `\n${'#'.repeat(level)} ${children.trim()}\n\n`;
      }
      case 'paragraph':
        return `\n${children.trim()}\n\n`;
      case 'bulletList':
        return '\n' + children + '\n';
      case 'orderedList':
        return '\n' + children + '\n';
      case 'listItem':
        return `- ${children.trim()}\n`;
      case 'codeBlock': {
        const lang = (node.attrs?.language as string) || '';
        return `\n\`\`\`${lang}\n${children.trim()}\n\`\`\`\n\n`;
      }
      case 'blockquote':
        return (
          '\n' +
          children
            .trim()
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n') +
          '\n\n'
        );
      case 'rule':
        return '\n---\n\n';
      case 'table':
      case 'tableRow':
      case 'tableCell':
      case 'tableHeader':
        // Simplified table handling
        return children;
      default:
        return children;
    }
  }

  return cleanMarkdown(processAdf(doc));
}

// ---------------------------------------------------------------------------
// Shared cleanup
// ---------------------------------------------------------------------------

function cleanMarkdown(md: string): string {
  return (
    md
      // Collapse 3+ newlines into 2
      .replace(/\n{3,}/g, '\n\n')
      // Remove trailing spaces on lines
      .replace(/[ \t]+$/gm, '')
      // Trim
      .trim()
  );
}
