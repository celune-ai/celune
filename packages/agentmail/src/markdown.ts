/**
 * Minimal Markdown-to-HTML converter.
 * Handles: headings, bold, italic, code blocks, inline code, lists, links, paragraphs, hr.
 * Intentionally lightweight — no external deps.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let listTag = '';

  const closePendingList = () => {
    if (inList) {
      out.push(`</${listTag}>`);
      inList = false;
      listTag = '';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw ?? '';

    // Fenced code block
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        closePendingList();
        const lang = line.slice(3).trim();
        out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>`);
        inCodeBlock = true;
      } else {
        out.push('</code></pre>');
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      out.push(escapeHtml(line));
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      closePendingList();
      out.push('');
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closePendingList();
      out.push('<hr>');
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closePendingList();
      const level = headingMatch[1]!.length;
      const content = inlineFormat(headingMatch[2] ?? '');
      out.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (!inList || listTag !== 'ul') {
        closePendingList();
        out.push('<ul>');
        inList = true;
        listTag = 'ul';
      }
      out.push(`<li>${inlineFormat(ulMatch[1] ?? '')}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (!inList || listTag !== 'ol') {
        closePendingList();
        out.push('<ol>');
        inList = true;
        listTag = 'ol';
      }
      out.push(`<li>${inlineFormat(olMatch[1] ?? '')}</li>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      closePendingList();
      out.push(`<blockquote>${inlineFormat(line.slice(1).trim())}</blockquote>`);
      continue;
    }

    // Regular paragraph
    closePendingList();
    out.push(`<p>${inlineFormat(line)}</p>`);
  }

  closePendingList();
  return wrapHtmlEmail(out.join('\n'));
}

function inlineFormat(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Inline code (before bold/italic to avoid double-processing)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapHtmlEmail(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; max-width: 720px; margin: 0 auto; padding: 24px; }
  h1, h2, h3 { margin-top: 24px; margin-bottom: 8px; }
  h1 { font-size: 22px; border-bottom: 1px solid #e5e5e5; padding-bottom: 8px; }
  h2 { font-size: 18px; }
  h3 { font-size: 15px; }
  pre { background: #f5f5f5; border-radius: 4px; padding: 12px; overflow-x: auto; }
  code { font-family: 'SF Mono', Consolas, monospace; font-size: 13px; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d0d0d0; margin: 0; padding-left: 16px; color: #555; }
  ul, ol { padding-left: 24px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #e5e5e5; padding: 6px 12px; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 20px 0; }
  a { color: #0066cc; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #888; font-size: 12px; }
</style>
</head>
<body>
${body}
<div class="footer">Sent by RICK · Celune agent system · <a href="https://agentmail.to">AgentMail</a></div>
</body>
</html>`;
}
