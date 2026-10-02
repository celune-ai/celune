/**
 * Shared utility functions for task-cli.mjs — extracted for testability.
 */

/**
 * Safely parse metadata from any input type.
 * - Plain object → returned as-is
 * - JSON string → parsed; if it yields an object, use it
 * - Double-serialized JSON string → auto-corrected with a warning
 * - Non-object JSON / invalid JSON / primitives → {}
 */
export function safeMetadata(raw) {
  if (!raw) return {};

  if (typeof raw === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      process.stderr.write(
        `Warning: metadata is not valid JSON: "${raw.slice(0, 80)}". Defaulting to {}.\n`,
      );
      return {};
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }

    // Double-serialization: JSON.parse yielded a string — try once more
    if (typeof parsed === 'string') {
      process.stderr.write(
        'Warning: metadata was double-serialized (string inside string). Auto-corrected.\n',
      );
      try {
        const inner = JSON.parse(parsed);
        return typeof inner === 'object' && inner !== null ? inner : {};
      } catch {
        return {};
      }
    }

    process.stderr.write(
      `Warning: metadata parsed to non-object type (${typeof parsed}). Defaulting to {}.\n`,
    );
    return {};
  }

  return typeof raw === 'object' ? raw : {};
}

/**
 * Parse the --metadata CLI flag value.
 * Returns a plain object, or null if the value was invalid.
 */
export function parseMetadataFlag(raw) {
  if (!raw) return null;
  const result = safeMetadata(raw);
  if (Object.keys(result).length === 0 && raw !== '{}') {
    process.stderr.write('Warning: --metadata value was invalid and ignored.\n');
    return null;
  }
  return result;
}
