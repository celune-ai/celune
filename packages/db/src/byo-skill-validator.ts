/**
 * BYO (Bring Your Own) Skill Validation and Quality Gates
 *
 * Validates user-submitted skills before they can be added to a workspace.
 * Checks structure, security, and quality to ensure BYO skills meet
 * minimum standards.
 */

import type { BYOSkillValidation, BrainCategory } from '@repo/types';

// ---------------------------------------------------------------------------
// Validation rules
// ---------------------------------------------------------------------------

/** Maximum skill content size (100KB) */
const MAX_CONTENT_SIZE = 100_000;

/** Minimum content size for a meaningful skill */
const MIN_CONTENT_SIZE = 50;

/** Patterns that indicate potential security issues */
const SECURITY_PATTERNS = [
  /process\.env\.\w+/i, // Direct env access
  /eval\s*\(/i, // eval usage
  /exec\s*\(/i, // exec usage
  /child_process/i, // subprocess spawning
  /SUPABASE_SERVICE_ROLE/i, // service key references
  /api[_-]?key\s*[:=]/i, // hardcoded API keys
  /password\s*[:=]\s*['"]/i, // hardcoded passwords
  /Bearer\s+[A-Za-z0-9_-]+/i, // hardcoded bearer tokens
];

/** Required sections for a well-structured skill */
const RECOMMENDED_SECTIONS = [
  /^#\s+/m, // Has a title
  /##.*(?:usage|how to|steps|instructions)/im, // Has usage section
];

/** Patterns that indicate a quality skill */
const QUALITY_INDICATORS = [
  /##\s+/m, // Has subsections
  /```/m, // Has code examples
  /\b(?:must|should|always|never)\b/im, // Has clear directives
  /\d+\.\s+/m, // Has numbered steps
  /[-*]\s+/m, // Has bullet points
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a BYO skill's content and structure.
 *
 * Returns a validation result with quality score (0-1), errors (blocking),
 * and warnings (non-blocking).
 */
export function validateBYOSkill(
  content: string,
  options: {
    path?: string;
    category?: BrainCategory;
  } = {},
): BYOSkillValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let qualityPoints = 0;
  let maxPoints = 0;

  // --- Size checks ---
  if (content.length > MAX_CONTENT_SIZE) {
    errors.push(`Content exceeds maximum size (${MAX_CONTENT_SIZE} characters)`);
  }
  if (content.length < MIN_CONTENT_SIZE) {
    errors.push(`Content is too short (minimum ${MIN_CONTENT_SIZE} characters)`);
  }

  // --- Security checks ---
  for (const pattern of SECURITY_PATTERNS) {
    if (pattern.test(content)) {
      errors.push(
        `Security concern: content matches pattern "${pattern.source}". Remove sensitive references.`,
      );
    }
  }

  // --- Path validation ---
  if (options.path) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(options.path)) {
      errors.push('Path contains invalid characters (use alphanumeric, /, _, -, . only)');
    }
    if (options.path.includes('..')) {
      errors.push('Path must not contain ".." (directory traversal)');
    }
    if (!options.path.endsWith('.md') && !options.path.endsWith('.sh')) {
      warnings.push('Skill files should end with .md or .sh');
    }

    // Check path matches category
    if (options.category === 'skill' && !options.path.startsWith('skills/')) {
      warnings.push('Skill files should be under the skills/ directory');
    }
    if (options.category === 'hook' && !options.path.startsWith('hooks/')) {
      warnings.push('Hook files should be under the hooks/ directory');
    }
  }

  // --- Structure quality ---
  maxPoints += RECOMMENDED_SECTIONS.length;
  for (const pattern of RECOMMENDED_SECTIONS) {
    if (pattern.test(content)) {
      qualityPoints++;
    } else {
      warnings.push(`Missing recommended section matching: ${pattern.source}`);
    }
  }

  // --- Content quality indicators ---
  maxPoints += QUALITY_INDICATORS.length;
  for (const pattern of QUALITY_INDICATORS) {
    if (pattern.test(content)) {
      qualityPoints++;
    }
  }

  // --- Bonus points ---
  maxPoints += 3;

  // Word count bonus (good skills are substantial)
  const wordCount = content.split(/\s+/).length;
  if (wordCount >= 100) qualityPoints++;
  if (wordCount >= 300) qualityPoints++;

  // Line count bonus
  const lineCount = content.split('\n').length;
  if (lineCount >= 20) qualityPoints++;

  // Calculate final score
  const quality_score = maxPoints > 0 ? Math.round((qualityPoints / maxPoints) * 100) / 100 : 0;

  return {
    valid: errors.length === 0,
    quality_score,
    errors,
    warnings,
  };
}

/**
 * Minimum quality score required for a BYO skill to be accepted.
 */
export const MIN_QUALITY_SCORE = 0.3;

/**
 * Check if a BYO skill meets the minimum quality threshold.
 */
export function meetsQualityGate(validation: BYOSkillValidation): boolean {
  return validation.valid && validation.quality_score >= MIN_QUALITY_SCORE;
}
