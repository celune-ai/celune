/**
 * Branded HTML email layout wrapper for Celune notifications.
 *
 * Dark-first design matching the app's aesthetic.
 * Uses #5BC586 brand green for accents.
 */

import { DEFAULT_APP_URL } from '../branding';

/**
 * Wrap inner HTML content in the branded Celune email layout.
 *
 * @param subject - Email subject (used in preheader text)
 * @param bodyHtml - Inner HTML content to place in the email body
 */
export function wrapInEmailLayout(subject: string, bodyHtml: string): string {
  const appUrl = DEFAULT_APP_URL;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]>
<style>body,table,td{font-family:Arial,Helvetica,sans-serif!important;}</style>
<![endif]-->
<style>
  body {
    margin: 0;
    padding: 0;
    background-color: #0a0a0a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    color: #e5e5e5;
    -webkit-font-smoothing: antialiased;
  }
  .email-wrapper {
    max-width: 600px;
    margin: 0 auto;
    padding: 0;
  }
  .email-header {
    padding: 32px 32px 24px;
    text-align: left;
  }
  .email-logo {
    font-size: 22px;
    font-weight: 700;
    color: #5BC586;
    text-decoration: none;
    letter-spacing: -0.5px;
  }
  .email-logo img {
    height: 28px;
    width: auto;
    vertical-align: middle;
  }
  .email-body {
    padding: 0 32px 32px;
  }
  .email-body h1, .email-body h2, .email-body h3 {
    color: #f5f5f5;
    margin-top: 20px;
    margin-bottom: 8px;
  }
  .email-body h1 { font-size: 22px; }
  .email-body h2 { font-size: 18px; }
  .email-body h3 { font-size: 15px; }
  .email-body p {
    margin: 8px 0;
    color: #d4d4d4;
  }
  .email-body a {
    color: #5BC586;
    text-decoration: underline;
  }
  .email-body strong {
    color: #f5f5f5;
  }
  .email-body hr {
    border: none;
    border-top: 1px solid #2a2a2a;
    margin: 20px 0;
  }
  .email-body ul, .email-body ol {
    padding-left: 24px;
    color: #d4d4d4;
  }
  .email-body li {
    margin-bottom: 4px;
  }
  .email-body blockquote {
    border-left: 3px solid #5BC586;
    margin: 12px 0;
    padding-left: 16px;
    color: #a3a3a3;
  }
  .email-body pre {
    background: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
    font-size: 13px;
  }
  .email-body code {
    font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
    font-size: 13px;
    background: #1a1a1a;
    padding: 2px 6px;
    border-radius: 4px;
    color: #5BC586;
  }
  .email-body pre code {
    background: none;
    padding: 0;
    color: #d4d4d4;
  }
  .email-cta {
    display: inline-block;
    background-color: #5BC586;
    color: #0a0a0a !important;
    font-weight: 600;
    font-size: 14px;
    padding: 10px 24px;
    border-radius: 6px;
    text-decoration: none;
    margin: 16px 0;
  }
  .email-footer {
    padding: 24px 32px;
    border-top: 1px solid #1a1a1a;
    text-align: center;
    color: #737373;
    font-size: 12px;
    line-height: 1.5;
  }
  .email-footer a {
    color: #737373;
    text-decoration: underline;
  }
  .email-divider {
    border: none;
    border-top: 1px solid #1a1a1a;
    margin: 0;
  }
</style>
</head>
<body>
  <div class="email-wrapper">
    <!-- Header -->
    <div class="email-header">
      <a href="${appUrl}" class="email-logo">
        <img src="${appUrl}/celune-logomark-light.svg" alt="celune" style="height:28px;width:auto;margin-right:8px;vertical-align:middle;">celune
      </a>
    </div>

    <!-- Body -->
    <div class="email-body">
      ${bodyHtml}
    </div>

    <!-- Footer -->
    <hr class="email-divider">
    <div class="email-footer">
      <p style="margin:0 0 8px;">Celune &mdash; Your AI-powered workspace</p>
      <p style="margin:0;">
        <a href="${appUrl}/settings?tab=notifications">Manage preferences</a>
        &nbsp;&middot;&nbsp;
        <a href="${appUrl}/unsubscribe">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Helper to create a CTA button for use inside email body HTML.
 */
export function emailCtaButton(text: string, url: string): string {
  return `<a href="${escapeHtml(url)}" class="email-cta" style="display:inline-block;background-color:#5BC586;color:#0a0a0a;font-weight:600;font-size:14px;padding:10px 24px;border-radius:6px;text-decoration:none;margin:16px 0;">${escapeHtml(text)}</a>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
