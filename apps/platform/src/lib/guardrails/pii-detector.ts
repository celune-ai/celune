/**
 * PII detection and redaction for the memory pipeline.
 *
 * Detects: email addresses, phone numbers, SSN patterns, credit card numbers,
 * API key prefixes (sk-ant-, sk-, gsk_, xai-, AIza).
 *
 * Redacts with placeholder tokens: [EMAIL], [PHONE], [SSN], [CREDIT_CARD], [API_KEY].
 * Applied BEFORE memory storage and BEFORE embedding generation.
 */

export interface PiiMatch {
  type: string;
  token: string;
  start: number;
  end: number;
}

export interface PiiScanResult {
  hasMatches: boolean;
  matches: PiiMatch[];
  redactedContent: string;
  originalLength: number;
}

/**
 * PII detection patterns.
 * Order matters: more specific patterns first to avoid partial matches.
 */
const PII_PATTERNS: [RegExp, string, string][] = [
  // API keys (most specific first)
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'api_key_anthropic', '[API_KEY]'],
  [/\bsk-or-[A-Za-z0-9_-]{20,}\b/g, 'api_key_openrouter', '[API_KEY]'],
  [/\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, 'api_key_openai_project', '[API_KEY]'],
  [/\bsk-[A-Za-z0-9_-]{32,}\b/g, 'api_key_openai', '[API_KEY]'],
  [/\bgsk_[A-Za-z0-9_-]{20,}\b/g, 'api_key_groq', '[API_KEY]'],
  [/\bxai-[A-Za-z0-9_-]{20,}\b/g, 'api_key_xai', '[API_KEY]'],
  [/\bAIza[A-Za-z0-9_-]{30,}\b/g, 'api_key_google', '[API_KEY]'],

  // Credit card numbers — require grouped digits (4-4-4-4 or similar) to avoid false positives
  [/\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g, 'credit_card', '[CREDIT_CARD]'],
  [/\b\d{4}[- ]\d{6}[- ]\d{5}\b/g, 'credit_card_amex', '[CREDIT_CARD]'],

  // SSN (US format: XXX-XX-XXXX)
  [/\b\d{3}-\d{2}-\d{4}\b/g, 'ssn', '[SSN]'],

  // Email addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'email', '[EMAIL]'],

  // Phone numbers (various formats)
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, 'phone', '[PHONE]'],
];

/**
 * Scan content for PII and return matches with redacted version.
 */
export function detectPii(content: string): PiiScanResult {
  const matches: PiiMatch[] = [];
  let redacted = content;

  for (const [pattern, type, token] of PII_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      matches.push({
        type,
        token,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    // Apply redaction
    redacted = redacted.replace(pattern, token);
  }

  return {
    hasMatches: matches.length > 0,
    matches,
    redactedContent: redacted,
    originalLength: content.length,
  };
}

/**
 * Redact PII from content, returning the sanitized string.
 * Convenience wrapper over detectPii when you only need the redacted output.
 */
export function redactPii(content: string): string {
  return detectPii(content).redactedContent;
}
