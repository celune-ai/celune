#!/usr/bin/env bash
# test-runner.sh — Run all test suites for a skill and output a JSON score report.
# This file is LOCKED. Agents MUST NOT modify it during improvement loops.
#
# Usage: test-runner.sh <skill-directory>
# Output: JSON to stdout with composite score and per-suite details.
# Exit 0 = success, non-zero = test infrastructure failure.

set -euo pipefail

SKILL_DIR="${1:?Usage: test-runner.sh <skill-directory>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Verify skill directory exists and has a SKILL.md or CLAUDE.md
if [ ! -d "$SKILL_DIR" ]; then
  echo '{"error": "Skill directory not found: '"$SKILL_DIR"'", "score": 0}' >&2
  exit 1
fi

SKILL_FILE=""
if [ -f "$SKILL_DIR/SKILL.md" ]; then
  SKILL_FILE="$SKILL_DIR/SKILL.md"
elif [ -f "$SKILL_DIR/CLAUDE.md" ]; then
  SKILL_FILE="$SKILL_DIR/CLAUDE.md"
else
  echo '{"error": "No SKILL.md or CLAUDE.md found in '"$SKILL_DIR"'", "score": 0}' >&2
  exit 1
fi

SKILL_NAME="$(basename "$SKILL_DIR")"

# ── Run built-in metric suites ──

# 1. Structure Score (40% weight)
structure_score=$("$SCRIPT_DIR/metrics/structure.sh" "$SKILL_FILE" 2>/dev/null || echo "0")

# 2. Clarity Score (35% weight)
clarity_score=$("$SCRIPT_DIR/metrics/clarity.sh" "$SKILL_FILE" 2>/dev/null || echo "0")

# 3. Completeness Score (25% weight)
completeness_score=$("$SCRIPT_DIR/metrics/completeness.sh" "$SKILL_FILE" 2>/dev/null || echo "0")

# ── Check for custom metric in GOAL.md ──
custom_score=""
if [ -f "$SKILL_DIR/GOAL.md" ]; then
  custom_metric=$(grep '^metric:' "$SKILL_DIR/GOAL.md" | head -1 | sed 's/^metric:[[:space:]]*//')
  # Security: only allow metric scripts that are basename-only (no path traversal)
  # and exist within the skill directory itself
  if [ -n "$custom_metric" ] && [ "$custom_metric" != "composite" ]; then
    custom_basename=$(basename "$custom_metric")
    if [ "$custom_basename" = "$custom_metric" ] && [ -f "$SKILL_DIR/$custom_basename" ]; then
      custom_score=$(bash "$SKILL_DIR/$custom_basename" "$SKILL_FILE" 2>/dev/null || echo "0")
    fi
  fi
fi

# ── Compute composite ──
# Weights: structure 40%, clarity 35%, completeness 25%
composite=$(python3 -c "
s = float('${structure_score}')
c = float('${clarity_score}')
m = float('${completeness_score}')
composite = (s * 0.40) + (c * 0.35) + (m * 0.25)
print(f'{composite:.1f}')
" 2>/dev/null || echo "0")

# ── Check for regression baseline ──
regression_delta=""
if [ -f "$SKILL_DIR/tests/baseline.json" ]; then
  baseline_score=$(python3 -c "
import json
with open('$SKILL_DIR/tests/baseline.json') as f:
    data = json.load(f)
print(data.get('composite', 0))
" 2>/dev/null || echo "0")
  regression_delta=$(python3 -c "print(f'{float(\"${composite}\") - float(\"${baseline_score}\"):.1f}')" 2>/dev/null || echo "0")
fi

# ── Output JSON report ──
python3 -c "
import json, sys

report = {
    'skill': '${SKILL_NAME}',
    'score': float('${composite}'),
    'structure_score': float('${structure_score}'),
    'clarity_score': float('${clarity_score}'),
    'completeness_score': float('${completeness_score}'),
    'weights': {'structure': 0.40, 'clarity': 0.35, 'completeness': 0.25},
}

custom = '${custom_score}'
if custom:
    report['custom_score'] = float(custom)

delta = '${regression_delta}'
if delta:
    report['regression_delta'] = float(delta)
    report['regression_passed'] = float(delta) >= -5.0  # Allow up to 5-point regression

report['passed'] = report['score'] >= 0  # Always passes unless infrastructure error

json.dump(report, sys.stdout, indent=2)
print()
"
