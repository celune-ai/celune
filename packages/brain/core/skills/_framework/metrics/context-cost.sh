#!/usr/bin/env bash
# context-cost.sh — Measure the context window footprint of a skill's core SKILL.md.
# Smaller skills score higher. This metric is tracked separately from the composite score.
#
# Usage: context-cost.sh <skill-file>
# Output: single integer score (0-100) to stdout.
#
# Scoring:
#   <100 lines  = 100 pts (excellent — minimal context load)
#   <150 lines  =  85 pts (good — lean core with refs)
#   <200 lines  =  70 pts (acceptable — within target)
#   <300 lines  =  50 pts (warning — consider refactoring)
#   <500 lines  =  25 pts (poor — needs layering)
#   500+ lines  =  10 pts (critical — immediate refactor needed)

set -euo pipefail

SKILL_FILE="${1:?Usage: context-cost.sh <skill-file>}"

if [ ! -f "$SKILL_FILE" ]; then
  echo "0"
  exit 0
fi

LINE_COUNT=$(wc -l < "$SKILL_FILE" | tr -d ' ')

# Check for refs/ directory (skills using layered architecture get a bonus)
SKILL_DIR="$(dirname "$SKILL_FILE")"
HAS_REFS=0
if [ -d "$SKILL_DIR/refs" ]; then
  REF_COUNT=$(find "$SKILL_DIR/refs" -name "*.md" | wc -l | tr -d ' ')
  if [ "$REF_COUNT" -gt 0 ]; then
    HAS_REFS=1
  fi
fi

# Base score from line count
if [ "$LINE_COUNT" -lt 100 ]; then
  SCORE=100
elif [ "$LINE_COUNT" -lt 150 ]; then
  SCORE=85
elif [ "$LINE_COUNT" -lt 200 ]; then
  SCORE=70
elif [ "$LINE_COUNT" -lt 300 ]; then
  SCORE=50
elif [ "$LINE_COUNT" -lt 500 ]; then
  SCORE=25
else
  SCORE=10
fi

# Bonus for using layered architecture (refs/ directory)
if [ "$HAS_REFS" -eq 1 ] && [ "$SCORE" -lt 100 ]; then
  BONUS=5
  SCORE=$((SCORE + BONUS))
  # Cap at 100
  if [ "$SCORE" -gt 100 ]; then
    SCORE=100
  fi
fi

echo "$SCORE"
