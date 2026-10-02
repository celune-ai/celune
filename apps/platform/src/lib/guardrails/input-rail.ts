/**
 * Input guardrails for agent chat — prompt injection defense and input sanitization.
 *
 * Fail-open: logs suspected injection attempts but does NOT block user messages.
 * This allows tuning false-positive rates before switching to fail-closed.
 *
 * Latency budget: < 50ms (pure regex, no LLM calls).
 */

export interface InputScanResult {
  flagged: boolean;
  patterns: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Known prompt injection patterns.
 * Each entry: [regex, pattern label, severity]
 */
const INJECTION_PATTERNS: [RegExp, string, 'low' | 'medium' | 'high'][] = [
  // Direct instruction override attempts
  [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
    'ignore_instructions',
    'high',
  ],
  [/disregard\s+(all\s+)?(previous|prior|above)/i, 'disregard_previous', 'high'],
  [
    /forget\s+(everything|all|your)\s+(instructions?|rules?|training)/i,
    'forget_instructions',
    'high',
  ],
  [
    /override\s+(your|the|all)\s+(instructions?|rules?|guidelines)/i,
    'override_instructions',
    'high',
  ],

  // System prompt extraction
  [
    /(?:what\s+is|show|tell|reveal|repeat|print|output)\s+(?:me\s+)?(?:your|the)\s+system\s+(?:prompt|message|instructions?)/i,
    'extract_system_prompt',
    'high',
  ],
  [/\bsystem\s*:\s*\b/i, 'system_role_injection', 'medium'],

  // Role manipulation
  [/you\s+are\s+now\s+(?:a|an|in)\s+(?:new|different|unrestricted)/i, 'role_override', 'high'],
  [
    /(?:act|behave|respond)\s+as\s+(?:if|though)\s+you\s+(?:have|had)\s+no\s+(?:rules|restrictions|guidelines)/i,
    'role_jailbreak',
    'high',
  ],
  [/\bDAN\s+mode\b/i, 'dan_jailbreak', 'high'],
  [/\bjailbreak\b/i, 'jailbreak_keyword', 'medium'],

  // Delimiter/context escape
  [/<\/?(?:system|assistant|human|user)\s*>/i, 'xml_tag_injection', 'medium'],
  [/```\s*(?:system|instructions?)\b/i, 'code_block_injection', 'medium'],

  // Data exfiltration
  [
    /(?:send|post|fetch|curl|wget)\s+(?:to|from)\s+(?:https?:\/\/|www\.)/i,
    'data_exfiltration',
    'medium',
  ],

  // Encoded/obfuscated payloads (base64 instructions)
  [/(?:decode|eval|execute)\s+(?:the\s+)?(?:following|this)\s*:/i, 'encoded_payload', 'low'],
];

/**
 * Scan a user message for prompt injection patterns.
 * Returns scan result with matched patterns and severity.
 */
export function scanInput(message: string): InputScanResult {
  const patterns: string[] = [];
  let maxSeverity: 'low' | 'medium' | 'high' = 'low';

  for (const [regex, label, severity] of INJECTION_PATTERNS) {
    if (regex.test(message)) {
      patterns.push(label);
      if (severity === 'high') maxSeverity = 'high';
      else if (severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium';
    }
  }

  return {
    flagged: patterns.length > 0,
    patterns,
    severity: patterns.length > 0 ? maxSeverity : 'low',
  };
}

/**
 * Scan all user messages in a conversation for injection patterns.
 * Returns combined result across all messages.
 */
export function scanConversation(
  messages: Array<{ role: string; content: string }>,
): InputScanResult {
  const allPatterns: string[] = [];
  let maxSeverity: 'low' | 'medium' | 'high' = 'low';

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const result = scanInput(msg.content);
    if (result.flagged) {
      allPatterns.push(...result.patterns);
      if (result.severity === 'high') maxSeverity = 'high';
      else if (result.severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium';
    }
  }

  return {
    flagged: allPatterns.length > 0,
    patterns: [...new Set(allPatterns)],
    severity: allPatterns.length > 0 ? maxSeverity : 'low',
  };
}
