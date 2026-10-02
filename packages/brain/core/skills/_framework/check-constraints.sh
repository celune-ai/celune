#!/usr/bin/env bash
# check-constraints.sh — Validate a skill change against anti-gaming constraints.
# Run AFTER a change is made, BEFORE accepting it.
# This file is LOCKED. Agents MUST NOT modify it.
#
# Usage: check-constraints.sh <skill-directory> <commit-hash>
#
# Checks:
#   1. Diff size gate (≤50 lines added per iteration)
#   2. Score jump detection (>25 point single-metric jump = flag)
#   3. GOAL.md tampering detection (GOAL.md must not be modified)
#   4. Framework file tampering detection
#   5. Constraint text preservation (constraints in GOAL.md unchanged)
#
# Exit codes:
#   0 = all checks passed
#   1 = constraint violation detected
#   2 = error

set -euo pipefail

SKILL_DIR="${1:?Usage: check-constraints.sh <skill-directory> <commit-hash>}"
COMMIT="${2:?Usage: check-constraints.sh <skill-directory> <commit-hash>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"

violations=()

# ── 1. Diff size gate ──
# Count lines added in the commit (excluding GOAL.md, tests/, improvements.jsonl)
LINES_ADDED=$(git diff "$COMMIT^..$COMMIT" -- "$SKILL_DIR" \
  ':!'"$SKILL_DIR"'/GOAL.md' \
  ':!'"$SKILL_DIR"'/tests/' \
  ':!'"$SKILL_DIR"'/improvements.jsonl' \
  2>/dev/null | grep -c '^+[^+]' 2>/dev/null || echo "0")

if [ "$LINES_ADDED" -gt 50 ]; then
  violations+=("DIFF_SIZE: $LINES_ADDED lines added (max 50)")
fi

# ── 2. GOAL.md tampering detection ──
GOAL_CHANGED=$(git diff "$COMMIT^..$COMMIT" -- "$SKILL_DIR/GOAL.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$GOAL_CHANGED" -gt 0 ]; then
  violations+=("GOAL_TAMPER: GOAL.md was modified (LOCKED file)")
fi

# ── 3. Framework file tampering detection ──
FRAMEWORK_CHANGED=$(git diff "$COMMIT^..$COMMIT" -- "packages/brain/core/skills/_framework/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$FRAMEWORK_CHANGED" -gt 0 ]; then
  violations+=("FRAMEWORK_TAMPER: Files in _framework/ were modified (LOCKED)")
fi

# ── 4. Template file tampering detection ──
TEMPLATE_CHANGED=$(git diff "$COMMIT^..$COMMIT" -- "packages/brain/core/skills/_templates/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TEMPLATE_CHANGED" -gt 0 ]; then
  violations+=("TEMPLATE_TAMPER: Files in _templates/ were modified (LOCKED)")
fi

# ── 5. Score jump detection ──
# Compare before/after scores for each metric dimension
if [ -f "$SKILL_DIR/tests/baseline.json" ]; then
  BEFORE_STRUCTURE=$(python3 -c "import json; print(json.load(open('$SKILL_DIR/tests/baseline.json')).get('structure_score', 0))" 2>/dev/null || echo "0")
  BEFORE_CLARITY=$(python3 -c "import json; print(json.load(open('$SKILL_DIR/tests/baseline.json')).get('clarity_score', 0))" 2>/dev/null || echo "0")
  BEFORE_COMPLETENESS=$(python3 -c "import json; print(json.load(open('$SKILL_DIR/tests/baseline.json')).get('completeness_score', 0))" 2>/dev/null || echo "0")

  AFTER_RESULT=$("$SCRIPT_DIR/test-runner.sh" "$SKILL_DIR" 2>/dev/null)
  AFTER_STRUCTURE=$(echo "$AFTER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('structure_score', 0))" 2>/dev/null || echo "0")
  AFTER_CLARITY=$(echo "$AFTER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('clarity_score', 0))" 2>/dev/null || echo "0")
  AFTER_COMPLETENESS=$(echo "$AFTER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('completeness_score', 0))" 2>/dev/null || echo "0")

  # Check for suspicious jumps (>25 points in any single metric)
  JUMP_RESULTS=$(python3 -c "
import sys
metrics = [
    ('structure', float('$BEFORE_STRUCTURE'), float('$AFTER_STRUCTURE')),
    ('clarity', float('$BEFORE_CLARITY'), float('$AFTER_CLARITY')),
    ('completeness', float('$BEFORE_COMPLETENESS'), float('$AFTER_COMPLETENESS')),
]
for name, before, after in metrics:
    delta = after - before
    if delta > 25:
        print(f'SCORE_JUMP: {name} jumped {before} to {after} (+{delta}) in single iteration')
" 2>/dev/null || true)
  if [ -n "$JUMP_RESULTS" ]; then
    while IFS= read -r line; do
      violations+=("$line")
    done <<< "$JUMP_RESULTS"
  fi
fi

# ── 6. Test file tampering detection ──
TESTS_CHANGED=$(git diff "$COMMIT^..$COMMIT" -- "$SKILL_DIR/tests/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TESTS_CHANGED" -gt 0 ]; then
  violations+=("TEST_TAMPER: Files in tests/ were modified (LOCKED)")
fi

# ── Output ──
if [ ${#violations[@]} -eq 0 ]; then
  echo '{"passed": true, "violations": []}'
  exit 0
else
  # Write violations to temp file for safe Python consumption
  VIOL_FILE=$(mktemp)
  printf '%s\n' "${violations[@]}" > "$VIOL_FILE"
  python3 -c "
import json
with open('$VIOL_FILE') as f:
    viols = [line.strip() for line in f if line.strip()]
print(json.dumps({'passed': False, 'violations': viols}, indent=2))
"
  rm -f "$VIOL_FILE"
  exit 1
fi
