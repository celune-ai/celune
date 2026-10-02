import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We import the utility functions from the ESM script. Vitest (with Vite)
// handles .mjs imports natively in ESM mode.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs file, no type declarations needed
import { safeMetadata, parseMetadataFlag } from '../../scripts/task-cli-utils.mjs';

// Silence stderr warnings during tests
beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

// ---------------------------------------------------------------------------
// safeMetadata
// ---------------------------------------------------------------------------

describe('safeMetadata', () => {
  it('returns {} for null/undefined/empty inputs', () => {
    expect(safeMetadata(null)).toEqual({});
    expect(safeMetadata(undefined)).toEqual({});
    expect(safeMetadata('')).toEqual({});
  });

  it('returns a plain object as-is', () => {
    const obj = { sprint: 1, agent: 'rick' };
    expect(safeMetadata(obj)).toBe(obj);
  });

  it('parses a valid JSON string into an object', () => {
    expect(safeMetadata('{"sprint":1,"agent":"rick"}')).toEqual({ sprint: 1, agent: 'rick' });
  });

  it('handles double-serialized JSON string (auto-corrects)', () => {
    // Double-serialization: the outer JSON.parse yields a string, not an object
    const inner = { sprint: 2, source: 'test' };
    const doubleEncoded = JSON.stringify(JSON.stringify(inner));
    expect(safeMetadata(doubleEncoded)).toEqual(inner);
  });

  it('returns {} and warns for non-JSON string input', () => {
    const result = safeMetadata('not-json');
    expect(result).toEqual({});
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it('returns {} for a JSON number (non-object)', () => {
    const result = safeMetadata('42');
    expect(result).toEqual({});
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('non-object type'));
  });

  it('returns {} for a JSON boolean (non-object)', () => {
    const result = safeMetadata('true');
    expect(result).toEqual({});
  });

  it('returns {} for primitives that are not strings or objects', () => {
    expect(safeMetadata(42 as unknown as string)).toEqual({});
  });

  it('warns when auto-correcting double-serialization', () => {
    const inner = { key: 'val' };
    const doubleEncoded = JSON.stringify(JSON.stringify(inner));
    safeMetadata(doubleEncoded);
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('double-serialized'));
  });
});

// ---------------------------------------------------------------------------
// parseMetadataFlag
// ---------------------------------------------------------------------------

describe('parseMetadataFlag', () => {
  it('returns null for falsy input', () => {
    expect(parseMetadataFlag(null)).toBeNull();
    expect(parseMetadataFlag(undefined)).toBeNull();
    expect(parseMetadataFlag('')).toBeNull();
  });

  it('returns a parsed object for a valid JSON string', () => {
    expect(parseMetadataFlag('{"sprint":3}')).toEqual({ sprint: 3 });
  });

  it('returns an empty object for the literal string "{}"', () => {
    expect(parseMetadataFlag('{}')).toEqual({});
  });

  it('returns null and warns for an invalid JSON string', () => {
    const result = parseMetadataFlag('bad-json');
    expect(result).toBeNull();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('invalid and ignored'),
    );
  });

  it('auto-corrects double-serialized metadata', () => {
    const inner = { sprint: 5, note: 'retro' };
    const doubleEncoded = JSON.stringify(JSON.stringify(inner));
    expect(parseMetadataFlag(doubleEncoded)).toEqual(inner);
  });
});
