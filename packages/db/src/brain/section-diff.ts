/**
 * Three-Way Section Diff Engine
 *
 * Compares base (original template), local (user version), and new (updated template)
 * at the section level to determine merge actions. Uses section hashes from the
 * section parser for efficient comparison.
 */

import { parseSections, type BrainSection } from './section-parser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionMergeResult {
  /** Sections that can be auto-applied: new version of unchanged local, or newly added sections. */
  autoMerged: Array<{ key: string; source: 'new' | 'added'; content: string }>;
  /** Sections changed in both local and new — require manual resolution. */
  conflicts: Array<{
    key: string;
    baseContent: string;
    localContent: string;
    newContent: string;
  }>;
  /** Sections removed in new but still present locally — flagged for review. */
  removed: Array<{ key: string; localContent: string }>;
  /** Sections unchanged across all three versions. */
  unchanged: Array<{ key: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index sections by key for O(1) lookup. */
function indexByKey(sections: BrainSection[]): Map<string, BrainSection> {
  const map = new Map<string, BrainSection>();
  for (const s of sections) {
    map.set(s.key, s);
  }
  return map;
}

/** Collect all unique section keys across all three maps in insertion order. */
function allKeys(...maps: Map<string, BrainSection>[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const map of maps) {
    for (const key of map.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Compute a three-way section merge.
 *
 * For each section key present in any of the three versions:
 * - **unchanged**: All three hashes match → no action needed.
 * - **accept-new**: Local == base but new differs → auto-merge new version.
 * - **keep-local**: Local differs from base but new == base → auto-merge local (keep it).
 * - **conflict**: Local != base AND new != base AND local != new → manual resolution.
 * - **added**: Key exists in new but not in base → auto-add.
 * - **removed**: Key exists in base but not in new, and local has it → flag for review.
 *
 * Sections that exist only in local (user added their own) are treated as unchanged
 * since neither base nor new has them — we keep them as-is.
 */
export function computeSectionMerge(
  baseContent: string,
  localContent: string,
  newContent: string,
): SectionMergeResult {
  const baseSections = indexByKey(parseSections(baseContent));
  const localSections = indexByKey(parseSections(localContent));
  const newSections = indexByKey(parseSections(newContent));

  const result: SectionMergeResult = {
    autoMerged: [],
    conflicts: [],
    removed: [],
    unchanged: [],
  };

  const keys = allKeys(baseSections, localSections, newSections);

  for (const key of keys) {
    const base = baseSections.get(key);
    const local = localSections.get(key);
    const newSec = newSections.get(key);

    if (base && local && newSec) {
      // Section exists in all three
      if (base.hash === local.hash && base.hash === newSec.hash) {
        // All identical → unchanged
        result.unchanged.push({ key, content: local.content });
      } else if (base.hash === local.hash && base.hash !== newSec.hash) {
        // Local untouched, new has updates → accept new
        result.autoMerged.push({ key, source: 'new', content: newSec.content });
      } else if (base.hash !== local.hash && base.hash === newSec.hash) {
        // Local changed, new unchanged → keep local (treat as unchanged)
        result.unchanged.push({ key, content: local.content });
      } else if (local.hash === newSec.hash) {
        // Both changed to the same thing → no conflict
        result.unchanged.push({ key, content: local.content });
      } else {
        // Both changed differently → conflict
        result.conflicts.push({
          key,
          baseContent: base.content,
          localContent: local.content,
          newContent: newSec.content,
        });
      }
    } else if (!base && !local && newSec) {
      // Only in new → added
      result.autoMerged.push({ key, source: 'added', content: newSec.content });
    } else if (!base && local && newSec) {
      // Not in base, in both local and new
      if (local.hash === newSec.hash) {
        result.unchanged.push({ key, content: local.content });
      } else {
        // Both added independently with different content → conflict
        result.conflicts.push({
          key,
          baseContent: '',
          localContent: local.content,
          newContent: newSec.content,
        });
      }
    } else if (base && local && !newSec) {
      // Removed in new, still exists locally → flag for review
      result.removed.push({ key, localContent: local.content });
    } else if (base && !local && newSec) {
      // User deleted locally, but new has updates — treat as auto-merge
      // since the new template wants it present
      if (base.hash === newSec.hash) {
        // New hasn't changed from base, user intentionally removed → respect removal
        // Don't include in results (user deleted it, template didn't change it)
      } else {
        // New has updates to a section user deleted → conflict
        result.conflicts.push({
          key,
          baseContent: base.content,
          localContent: '',
          newContent: newSec.content,
        });
      }
    } else if (base && !local && !newSec) {
      // Was in base, removed by both local and new → gone, no action
    } else if (!base && local && !newSec) {
      // User-added section not in base or new → keep as unchanged
      result.unchanged.push({ key, content: local.content });
    }
    // !base && !local && !newSec shouldn't happen since we derived keys from the maps
  }

  return result;
}
