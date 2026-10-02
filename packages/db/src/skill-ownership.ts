/**
 * Skill Ownership — two-tier skill management (personal vs org).
 *
 * Users can create custom skills in their workspace. Org owners can
 * promote skills to org-level for team-wide inheritance. Duplicate
 * detection warns when a custom skill overlaps with the Celune Skill Library.
 */

import { CORE_MANIFEST, type ManifestEntry } from './brain-manifest-registry';

/** Result of checking a skill path against the Celune Skill Library */
export interface SkillDuplicateCheck {
  /** Whether a duplicate was found in the core library */
  isDuplicate: boolean;
  /** The matching core entry, if found */
  coreMatch: ManifestEntry | null;
  /** Similarity explanation */
  reason: string;
}

/**
 * Check if a skill path or name duplicates an existing core skill.
 * Uses path-based matching and name similarity.
 */
export function checkSkillDuplicate(skillPath: string): SkillDuplicateCheck {
  const normalizedPath = skillPath.toLowerCase().replace(/^\.claude\//, '');
  const skillName = extractSkillName(normalizedPath);

  // Check for exact path match
  const exactMatch = getCoreSkills().find((e) => e.path.toLowerCase() === normalizedPath);
  if (exactMatch) {
    return {
      isDuplicate: true,
      coreMatch: exactMatch,
      reason: `Exact path match with core skill: ${exactMatch.description}`,
    };
  }

  // Check for name-based match (case-insensitive)
  const nameMatch = getCoreSkills().find((e) => {
    const coreName = extractSkillName(e.path.toLowerCase());
    return coreName.toLowerCase() === skillName.toLowerCase();
  });
  if (nameMatch) {
    return {
      isDuplicate: true,
      coreMatch: nameMatch,
      reason: `Name matches core skill "${nameMatch.description}". Consider using the core version or renaming.`,
    };
  }

  return {
    isDuplicate: false,
    coreMatch: null,
    reason: '',
  };
}

/**
 * Get all core skills from the manifest registry.
 */
export function getCoreSkills(): ManifestEntry[] {
  return CORE_MANIFEST.filter((e) => e.category === 'skill');
}

/**
 * Get skills organized by ownership scope for display.
 */
export function categorizeSkills(
  manifestEntries: Array<{ path: string; ownership_scope: string; [key: string]: unknown }>,
): {
  mySkills: typeof manifestEntries;
  orgSkills: typeof manifestEntries;
  coreSkills: typeof manifestEntries;
} {
  return {
    mySkills: manifestEntries.filter(
      (e) => e.ownership_scope === 'workspace' && isSkillPath(e.path),
    ),
    orgSkills: manifestEntries.filter((e) => e.ownership_scope === 'org' && isSkillPath(e.path)),
    coreSkills: manifestEntries.filter((e) => e.ownership_scope === 'core' && isSkillPath(e.path)),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractSkillName(path: string): string {
  // "skills/build/CLAUDE.md" → "build"
  // "skills/context-management/CLAUDE.md" → "context-management"
  const parts = path.split('/');
  const skillIdx = parts.indexOf('skills');
  if (skillIdx >= 0 && skillIdx + 1 < parts.length) {
    return parts[skillIdx + 1]!;
  }
  return parts[parts.length - 1]?.replace(/\.md$/i, '') ?? path;
}

function isSkillPath(path: string): boolean {
  return path.startsWith('skills/') || path.includes('/skills/');
}
