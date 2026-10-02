/**
 * Output content safety filtering for agent responses.
 *
 * Scans LLM output for: leaked system prompts, harmful instructions,
 * policy violations, and personal attacks.
 *
 * Fail-open: logs flagged content but delivers the response.
 * Latency budget: < 100ms (pure regex, no external calls).
 */

export interface OutputScanResult {
  flagged: boolean;
  patterns: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Output safety patterns.
 * Each entry: [regex, pattern label, severity]
 */
const OUTPUT_PATTERNS: [RegExp, string, 'low' | 'medium' | 'high'][] = [
  // System prompt leakage
  [/\bmy\s+system\s+prompt\s+(?:is|says|tells|instructs)\b/i, 'system_prompt_leak', 'high'],
  [/\bhere\s+(?:is|are)\s+my\s+(?:system\s+)?instructions?\b/i, 'instructions_leak', 'high'],
  [/\bi\s+was\s+(?:told|instructed|programmed)\s+to\b/i, 'training_leak', 'medium'],

  // Harmful content indicators
  [
    /\bhow\s+to\s+(?:make|build|create)\s+(?:a\s+)?(?:bomb|explosive|weapon)\b/i,
    'harmful_instructions',
    'high',
  ],
  [
    /\bstep[- ]by[- ]step\s+(?:guide|instructions?)\s+(?:to|for)\s+(?:hack|exploit|attack)\b/i,
    'attack_instructions',
    'high',
  ],

  // Credential/secret leakage in responses
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'api_key_leak', 'high'],
  [/\bsk-[A-Za-z0-9_-]{32,}\b/g, 'api_key_leak', 'high'],
  [/\bgsk_[A-Za-z0-9_-]{20,}\b/g, 'api_key_leak', 'high'],

  // Internal path leakage
  [/\/Users\/[a-zA-Z]+\//g, 'local_path_leak', 'medium'],
  [/\b(?:SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY)\s*[=:]\s*\S+/i, 'env_var_leak', 'high'],
];

/**
 * Streaming output scanner for chunk-level filtering (fail-closed mode).
 *
 * Accumulates text across chunks and scans progressively. When a violation
 * is detected mid-stream, `shouldBlock` returns true and the caller can
 * stop enqueuing chunks to the client.
 *
 * Usage:
 *   const scanner = createStreamScanner();
 *   while (streaming) {
 *     scanner.push(chunk);
 *     if (scanner.shouldBlock()) { controller.error(...); break; }
 *     controller.enqueue(chunk);
 *   }
 *   const result = scanner.finalize();
 */
export function createStreamScanner() {
  let buffer = '';
  let blocked = false;
  let blockResult: OutputScanResult | null = null;

  return {
    /** Add a new text chunk to the buffer and scan. */
    push(chunk: string): void {
      if (blocked) return;
      buffer += chunk;
      // Only scan when we have enough context (every 200 chars or credential patterns)
      if (buffer.length % 200 < chunk.length || /\bsk-|gsk_|SUPABASE_/i.test(chunk)) {
        const result = scanOutput(buffer);
        if (result.flagged && result.severity === 'high') {
          blocked = true;
          blockResult = result;
        }
      }
    },
    /** True if a high-severity violation was detected. */
    shouldBlock(): boolean {
      return blocked;
    },
    /** Get the block reason (null if not blocked). */
    getBlockResult(): OutputScanResult | null {
      return blockResult;
    },
    /** Final scan on the complete response text. */
    finalize(): OutputScanResult {
      return scanOutput(buffer);
    },
  };
}

/**
 * Scan output text for content safety violations.
 */
export function scanOutput(text: string): OutputScanResult {
  const patterns: string[] = [];
  let maxSeverity: 'low' | 'medium' | 'high' = 'low';

  for (const [regex, label, severity] of OUTPUT_PATTERNS) {
    // Reset global regex
    if (regex.global) regex.lastIndex = 0;
    if (regex.test(text)) {
      patterns.push(label);
      if (severity === 'high') maxSeverity = 'high';
      else if (severity === 'medium' && maxSeverity !== 'high') maxSeverity = 'medium';
    }
  }

  return {
    flagged: patterns.length > 0,
    patterns: [...new Set(patterns)],
    severity: patterns.length > 0 ? maxSeverity : 'low',
  };
}
