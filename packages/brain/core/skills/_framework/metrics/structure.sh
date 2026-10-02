#!/usr/bin/env bash
# structure.sh — Measure structural quality of a skill file.
# Checks: YAML frontmatter, required sections, heading hierarchy, file size.
# Output: single integer score (0-100) to stdout.
# This file is LOCKED. Agents MUST NOT modify it.

set -euo pipefail

SKILL_FILE="${1:?Usage: structure.sh <skill-file>}"

if [ ! -f "$SKILL_FILE" ]; then
  echo "0"
  exit 0
fi

score=0
max_points=0

# ── 1. File exists and is non-empty (10 points) ──
max_points=$((max_points + 10))
if [ -s "$SKILL_FILE" ]; then
  score=$((score + 10))
fi

# ── 2. Has YAML frontmatter or starts with heading (10 points) ──
max_points=$((max_points + 10))
first_line=$(head -1 "$SKILL_FILE")
if [[ "$first_line" == "---" ]] || [[ "$first_line" == "#"* ]]; then
  score=$((score + 10))
fi

# ── 3. Has at least one H1 or H2 heading (10 points) ──
max_points=$((max_points + 10))
h1_count=$(grep -c '^# ' "$SKILL_FILE" 2>/dev/null || echo "0")
h2_count=$(grep -c '^## ' "$SKILL_FILE" 2>/dev/null || echo "0")
if [ "$((h1_count + h2_count))" -gt 0 ]; then
  score=$((score + 10))
fi

# ── 4. Has multiple sections (H2+) — indicates structured content (15 points) ──
max_points=$((max_points + 15))
if [ "$h2_count" -ge 3 ]; then
  score=$((score + 15))
elif [ "$h2_count" -ge 2 ]; then
  score=$((score + 10))
elif [ "$h2_count" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 5. Has ## What or ## Approach section (15 points) ──
max_points=$((max_points + 15))
has_what=$(grep -c '^## What' "$SKILL_FILE" 2>/dev/null || echo "0")
has_approach=$(grep -c '^## Approach\|^## Workflow\|^## Process' "$SKILL_FILE" 2>/dev/null || echo "0")
if [ "$has_what" -gt 0 ] && [ "$has_approach" -gt 0 ]; then
  score=$((score + 15))
elif [ "$has_what" -gt 0 ] || [ "$has_approach" -gt 0 ]; then
  score=$((score + 8))
fi

# ── 6. Reasonable file size — not too short, not too long (10 points) ──
max_points=$((max_points + 10))
line_count=$(wc -l < "$SKILL_FILE" | tr -d ' ')
if [ "$line_count" -ge 20 ] && [ "$line_count" -le 500 ]; then
  score=$((score + 10))
elif [ "$line_count" -ge 10 ] && [ "$line_count" -le 800 ]; then
  score=$((score + 5))
fi

# ── 7. Has code blocks (indicates concrete instructions) (10 points) ──
max_points=$((max_points + 10))
code_blocks=$(grep -c '```' "$SKILL_FILE" 2>/dev/null || echo "0")
if [ "$code_blocks" -ge 2 ]; then
  score=$((score + 10))
elif [ "$code_blocks" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 8. Has numbered lists (indicates step-by-step approach) (10 points) ──
max_points=$((max_points + 10))
numbered_lists=$(grep -c '^[0-9]\+\.' "$SKILL_FILE" 2>/dev/null || echo "0")
if [ "$numbered_lists" -ge 3 ]; then
  score=$((score + 10))
elif [ "$numbered_lists" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 9. Has tables (indicates structured data) (5 points) ──
max_points=$((max_points + 5))
tables=$(grep -c '|.*|.*|' "$SKILL_FILE" 2>/dev/null || echo "0")
if [ "$tables" -ge 2 ]; then
  score=$((score + 5))
fi

# ── 10. No obvious issues (5 points) ──
max_points=$((max_points + 5))
# Check for common problems: TODO markers, empty sections, broken references
todos=$(grep -ci 'TODO\|FIXME\|XXX\|HACK' "$SKILL_FILE" 2>/dev/null || echo "0")
if [ "$todos" -eq 0 ]; then
  score=$((score + 5))
fi

# Normalize to 0-100
if [ "$max_points" -gt 0 ]; then
  final_score=$(( (score * 100) / max_points ))
else
  final_score=0
fi

echo "$final_score"
