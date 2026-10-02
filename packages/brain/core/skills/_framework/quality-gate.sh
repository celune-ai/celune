#!/usr/bin/env bash
# quality-gate.sh — Quality gate check for skill publishing/creation.
# Runs the test harness and enforces minimum score before a skill
# can be published to the brain or included in a new project.
# This file is LOCKED. Agents MUST NOT modify it.
#
# Usage: quality-gate.sh <skill-directory> [--min-score N] [--require-goal]
#
# Exit codes:
#   0 = passed (score meets minimum)
#   1 = failed (score below minimum or missing requirements)
#   2 = error (skill not found, etc.)
#
# Output: JSON report to stdout

set -euo pipefail

SKILL_DIR="${1:?Usage: quality-gate.sh <skill-directory> [--min-score N] [--require-goal]}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIN_SCORE=30
REQUIRE_GOAL=false

# Parse optional args
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --min-score) MIN_SCORE="$2"; shift 2 ;;
    --require-goal) REQUIRE_GOAL=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

SKILL_NAME="$(basename "$SKILL_DIR")"

# ── Validate inputs ──
if [ ! -d "$SKILL_DIR" ]; then
  echo "{\"passed\": false, \"error\": \"Skill directory not found: $SKILL_DIR\"}"
  exit 2
fi

# Check for skill file
SKILL_FILE=""
if [ -f "$SKILL_DIR/SKILL.md" ]; then
  SKILL_FILE="$SKILL_DIR/SKILL.md"
elif [ -f "$SKILL_DIR/CLAUDE.md" ]; then
  SKILL_FILE="$SKILL_DIR/CLAUDE.md"
else
  echo "{\"passed\": false, \"error\": \"No SKILL.md or CLAUDE.md found\"}"
  exit 2
fi

# Check for GOAL.md if required
if [ "$REQUIRE_GOAL" = true ] && [ ! -f "$SKILL_DIR/GOAL.md" ]; then
  echo "{\"passed\": false, \"error\": \"GOAL.md required but not found. Run generate-harness.sh first.\"}"
  exit 1
fi

# ── Auto-generate harness if missing ──
if [ ! -f "$SKILL_DIR/GOAL.md" ]; then
  "$SCRIPT_DIR/generate-harness.sh" "$SKILL_DIR" >/dev/null 2>&1
fi

# ── Run test suite ──
RESULT=$("$SCRIPT_DIR/test-runner.sh" "$SKILL_DIR" 2>/dev/null)
SCORE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('score', 0))" 2>/dev/null || echo "0")
STRUCTURE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('structure_score', 0))" 2>/dev/null || echo "0")
CLARITY=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('clarity_score', 0))" 2>/dev/null || echo "0")
COMPLETENESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('completeness_score', 0))" 2>/dev/null || echo "0")

# ── Check minimum score ──
PASSED=$(python3 -c "print('true' if float('$SCORE') >= float('$MIN_SCORE') else 'false')" 2>/dev/null || echo "false")

# ── Check for critical failures ──
# Structure score of 0 means the file is empty or has no markdown structure at all
CRITICAL_FAIL=false
if python3 -c "exit(0 if float('$STRUCTURE') == 0 else 1)" 2>/dev/null; then
  CRITICAL_FAIL=true
  PASSED="false"
fi

# ── Build issues list ──
ISSUES=$(python3 -c "
issues = []
score = float('$SCORE')
structure = float('$STRUCTURE')
clarity = float('$CLARITY')
completeness = float('$COMPLETENESS')
min_score = float('$MIN_SCORE')

if score < min_score:
    issues.append(f'Composite score {score} is below minimum {min_score}')
if structure < 30:
    issues.append(f'Structure score {structure} is critically low (needs headings, sections)')
if clarity < 20:
    issues.append(f'Clarity score {clarity} is critically low (needs concrete paths, commands, examples)')
if completeness < 20:
    issues.append(f'Completeness score {completeness} is critically low (needs error handling, edge cases)')

import json
print(json.dumps(issues))
" 2>/dev/null || echo "[]")

# ── Output report ──
python3 -c "
import json
report = {
    'skill': '$SKILL_NAME',
    'passed': '$PASSED' == 'true',
    'score': float('$SCORE'),
    'min_score': float('$MIN_SCORE'),
    'structure_score': float('$STRUCTURE'),
    'clarity_score': float('$CLARITY'),
    'completeness_score': float('$COMPLETENESS'),
    'critical_fail': '$CRITICAL_FAIL' == 'true',
    'issues': json.loads('$ISSUES')
}
print(json.dumps(report, indent=2))
"

if [ "$PASSED" = "true" ]; then
  exit 0
else
  exit 1
fi
