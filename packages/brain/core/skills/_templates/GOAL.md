---
# GOAL.md — Skill Fitness Function Specification
# This file is LOCKED. Agents MUST NOT modify it during improvement loops.
# Only the workspace owner can update GOAL.md files.

# ── Required Fields ──

# How to measure skill quality. Either a built-in metric name or path to a custom script.
# Built-in metrics: structure_score, clarity_score, completeness_score, composite
# Custom: path relative to skill directory, e.g., "tests/custom-metric.sh"
metric: composite

# Which direction is better: "higher_is_better" or "lower_is_better"
direction: higher_is_better

# Operating mode:
#   converge    — stop when target score reached
#   continuous  — run until session cap (default for overnight)
#   supervised  — create task for the user to review each improvement before applying
mode: supervised

# Maximum iterations per improvement session for this skill
max_iterations: 20

# ── Constraints ──
# Rules the improvement agent MUST NOT violate. Checked before each modification.
# Violations trigger automatic revert + log entry.
constraints:
  - 'Never remove or rename existing sections'
  - 'Never modify GOAL.md or files in tests/'
  - "Preserve the skill's argument format and trigger conditions"
  - 'Never add more than 50 lines in a single iteration'
  - 'Maintain backward compatibility with existing task descriptions'

# ── Optional Fields ──

# Target score (only used in 'converge' mode). Loop stops when score >= target.
# target_score: 90

# Days before this skill is considered 'stale' and prioritized for improvement
staleness_threshold_days: 14

# Wall-clock time limit per improvement session for this skill
time_cap_minutes: 30

# ── Action Catalog ──
# Prioritized menu of improvements the agent should try.
# P0 = highest impact, try first. Agent skips already-attempted actions.
# Each action has: priority, category, description, and expected impact.
#
# Categories (mandatory rotation — no 2+ consecutive from same category):
#   structure   — section ordering, hierarchy, headings, required sections
#   clarity     — instruction specificity, ambiguity reduction, concrete examples
#   coverage    — edge cases, error handling, failure modes, missing scenarios
#   approach    — step quality, completeness, action specificity, verification steps
action_catalog:
  - priority: P0
    category: coverage
    description: 'Add missing edge case handling for common failure modes'
    impact: high

  - priority: P1
    category: clarity
    description: 'Replace vague instructions with concrete file paths and commands'
    impact: high

  - priority: P1
    category: approach
    description: 'Ensure every approach step is actionable (verb + noun + target)'
    impact: medium

  - priority: P2
    category: structure
    description: 'Verify all required sections present and correctly ordered'
    impact: medium

  - priority: P2
    category: coverage
    description: 'Add error recovery steps for each approach step that can fail'
    impact: medium

  - priority: P3
    category: clarity
    description: 'Add concrete examples for complex or ambiguous instructions'
    impact: low
---

# Skill Fitness Function

This file defines how to mechanically measure and improve this skill's quality.
It is **immutable during improvement loops** — the agent can read but never modify it.

## Metric Definitions

### Built-in Metrics

| Metric               | What it measures                                                      | Score range |
| -------------------- | --------------------------------------------------------------------- | ----------- |
| `structure_score`    | Required sections present, correct ordering, valid YAML frontmatter   | 0-100       |
| `clarity_score`      | Instruction specificity, concrete vs vague language, actionable steps | 0-100       |
| `completeness_score` | Edge case coverage, error handling, failure modes addressed           | 0-100       |
| `composite`          | Weighted average: 40% structure + 35% clarity + 25% completeness      | 0-100       |

### Custom Metrics

Point `metric` to a shell script that outputs a JSON object:

```json
{ "score": 85, "details": { "check1": 90, "check2": 80 } }
```

Exit code 0 = success, non-zero = test failure (automatic revert).

## Category Rotation

The improvement loop enforces **mandatory category rotation**:

- After 2 consecutive attempts in the same category, the next attempt MUST use a different category
- This prevents local optima from repetitive parameter tweaking
- Categories: `structure`, `clarity`, `coverage`, `approach`

## Constraint Enforcement

Before each modification, the loop engine:

1. Hashes GOAL.md and all test files — rejects if any changed
2. Checks structural constraints (sections not removed, API preserved)
3. Validates the diff doesn't exceed size limits
4. Runs correctness gate before performance gate

Violations trigger: automatic `git revert HEAD`, log entry with `"violation": true`.
