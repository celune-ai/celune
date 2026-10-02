#!/usr/bin/env bash
# improve-loop.sh — Core improvement loop engine for skill self-improvement.
# Implements the AutoResearch Modify → Verify → Keep/Revert cycle.
# This file is LOCKED. Agents MUST NOT modify it.
#
# Usage: improve-loop.sh <skill-directory> [--max-iterations N] [--dry-run]
#
# Reads GOAL.md for configuration, runs test-runner.sh for scoring,
# logs results to improvements.jsonl, auto-reverts on regression.

set -euo pipefail

SKILL_DIR="${1:?Usage: improve-loop.sh <skill-directory> [--max-iterations N] [--dry-run]}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAX_ITER_OVERRIDE=""
DRY_RUN=false

# Parse optional args
shift
while [ $# -gt 0 ]; do
  case "$1" in
    --max-iterations) MAX_ITER_OVERRIDE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SKILL_NAME="$(basename "$SKILL_DIR")"

# ── Validate inputs ──
if [ ! -d "$SKILL_DIR" ]; then
  echo "Error: Skill directory not found: $SKILL_DIR" >&2
  exit 1
fi

if [ ! -f "$SKILL_DIR/GOAL.md" ]; then
  echo "Error: No GOAL.md found in $SKILL_DIR. Run generate-harness.sh first." >&2
  exit 1
fi

# Find skill file
SKILL_FILE=""
if [ -f "$SKILL_DIR/SKILL.md" ]; then
  SKILL_FILE="$SKILL_DIR/SKILL.md"
elif [ -f "$SKILL_DIR/CLAUDE.md" ]; then
  SKILL_FILE="$SKILL_DIR/CLAUDE.md"
else
  echo "Error: No SKILL.md or CLAUDE.md found in $SKILL_DIR" >&2
  exit 1
fi

# ── Parse GOAL.md frontmatter ──
parse_goal_field() {
  local field="$1"
  local goal_file="$SKILL_DIR/GOAL.md"
  # Extract value from YAML frontmatter between --- markers
  sed -n '/^---$/,/^---$/p' "$goal_file" | grep "^${field}:" | head -1 | sed "s/^${field}:[[:space:]]*//"
}

MODE=$(parse_goal_field "mode")
MAX_ITERATIONS=$(parse_goal_field "max_iterations")
TIME_CAP=$(parse_goal_field "time_cap_minutes")
DIRECTION=$(parse_goal_field "direction")

# Apply overrides
[ -n "$MAX_ITER_OVERRIDE" ] && MAX_ITERATIONS="$MAX_ITER_OVERRIDE"
[ -z "$MAX_ITERATIONS" ] && MAX_ITERATIONS=10
[ -z "$TIME_CAP" ] && TIME_CAP=15
[ -z "$MODE" ] && MODE="continuous"
[ -z "$DIRECTION" ] && DIRECTION="higher_is_better"

# ── Parse constraints ──
CONSTRAINTS_FILE=$(mktemp)
ACTIONS_FILE=$(mktemp)
trap 'rm -f "$CONSTRAINTS_FILE" "$ACTIONS_FILE"' EXIT

sed -n '/^constraints:/,/^[a-z]/p' "$SKILL_DIR/GOAL.md" | grep '^ *- ' | sed 's/^ *- *//' | tr -d '"' > "$CONSTRAINTS_FILE"

# ── Parse action catalog ──
# Extract action items as tab-separated: priority\tcategory\tdescription
python3 -c "
import re, sys

goal_path = '$SKILL_DIR/GOAL.md'
with open(goal_path) as f:
    content = f.read()

# Extract between --- markers
parts = content.split('---')
if len(parts) < 3:
    sys.exit(0)
frontmatter = parts[1]

# Parse action_catalog entries
current = {}
actions = []
for line in frontmatter.split('\n'):
    line = line.strip()
    if line.startswith('- priority:'):
        if current:
            actions.append(current)
        current = {'priority': line.split(':',1)[1].strip()}
    elif line.startswith('category:') and current:
        current['category'] = line.split(':',1)[1].strip()
    elif line.startswith('description:') and current:
        current['description'] = line.split(':',1)[1].strip().strip('\"')
    elif line.startswith('impact:') and current:
        current['impact'] = line.split(':',1)[1].strip()

if current:
    actions.append(current)

# Sort by priority (P0 first)
actions.sort(key=lambda a: a.get('priority', 'P9'))

for a in actions:
    print(f\"{a.get('priority','P9')}\t{a.get('category','general')}\t{a.get('description','')}\")
" > "$ACTIONS_FILE" 2>/dev/null || true

ACTION_COUNT=$(wc -l < "$ACTIONS_FILE" | tr -d ' ')

# ── Initialize tracking ──
IMPROVEMENTS_LOG="$SKILL_DIR/improvements.jsonl"
touch "$IMPROVEMENTS_LOG"

# Track last 2 categories for rotation enforcement
LAST_CAT_1=""
LAST_CAT_2=""

# Load last 2 categories from improvements log
if [ -f "$IMPROVEMENTS_LOG" ] && [ -s "$IMPROVEMENTS_LOG" ]; then
  LAST_CAT_1=$(tail -1 "$IMPROVEMENTS_LOG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('category',''))" 2>/dev/null || echo "")
  LAST_CAT_2=$(tail -2 "$IMPROVEMENTS_LOG" | head -1 | python3 -c "import sys,json; print(json.load(sys.stdin).get('category',''))" 2>/dev/null || echo "")
fi

# ── Get baseline score ──
BASELINE_RESULT=$("$SCRIPT_DIR/test-runner.sh" "$SKILL_DIR" 2>/dev/null)
BASELINE_SCORE=$(echo "$BASELINE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('score', 0))" 2>/dev/null || echo "0")

echo "╔══════════════════════════════════════════════╗"
echo "║  Skill Improvement Loop: $SKILL_NAME"
echo "║  Mode: $MODE | Max iterations: $MAX_ITERATIONS"
echo "║  Time cap: ${TIME_CAP}m | Baseline: $BASELINE_SCORE"
echo "║  Actions available: $ACTION_COUNT"
echo "╚══════════════════════════════════════════════╝"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "DRY RUN — showing action catalog and exiting."
  echo ""
  echo "Actions (sorted by priority):"
  cat "$ACTIONS_FILE" | while IFS=$'\t' read -r pri cat desc; do
    echo "  [$pri] ($cat) $desc"
  done
  echo ""
  echo "Constraints:"
  cat "$CONSTRAINTS_FILE" | while read -r c; do
    echo "  - $c"
  done
  rm -f "$CONSTRAINTS_FILE" "$ACTIONS_FILE"
  exit 0
fi

# ── Main improvement loop ──
# This script does NOT make modifications itself — it's the orchestrator.
# It outputs a JSON plan for each iteration that the calling agent executes.
# After the agent makes changes, it calls test-runner.sh to verify.

CURRENT_SCORE="$BASELINE_SCORE"
ITERATION=0
START_TIME=$(date +%s)
KEPT=0
REVERTED=0
SKIPPED=0

select_next_action() {
  # Pick next action respecting category rotation (no 2 consecutive same category)
  python3 -c "
import sys

actions_file = '$ACTIONS_FILE'
last_cat_1 = '$LAST_CAT_1'
last_cat_2 = '$LAST_CAT_2'
iteration = $ITERATION

with open(actions_file) as f:
    actions = [line.strip().split('\t') for line in f if line.strip()]

if not actions:
    print('EXHAUSTED')
    sys.exit(0)

# Filter out actions with same category as last 2
candidates = []
for a in actions:
    pri, cat, desc = a[0], a[1], a[2] if len(a) > 2 else ''
    # Category rotation: skip if same as last 2 consecutive
    if cat == last_cat_1 == last_cat_2 and last_cat_1:
        continue
    candidates.append((pri, cat, desc))

if not candidates:
    # If rotation blocks everything, relax constraint
    candidates = [(a[0], a[1], a[2] if len(a) > 2 else '') for a in actions]

# Pick highest priority (already sorted)
pri, cat, desc = candidates[0]
print(f'{pri}\t{cat}\t{desc}')
" 2>/dev/null || echo "EXHAUSTED"
}

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
  # Time check
  NOW=$(date +%s)
  ELAPSED=$(( (NOW - START_TIME) / 60 ))
  if [ "$ELAPSED" -ge "$TIME_CAP" ]; then
    echo ""
    echo "Time cap reached (${ELAPSED}m >= ${TIME_CAP}m). Stopping."
    break
  fi

  ITERATION=$((ITERATION + 1))

  # Select next action
  NEXT_ACTION=$(select_next_action)

  if [ "$NEXT_ACTION" = "EXHAUSTED" ]; then
    echo ""
    echo "Action catalog exhausted. Stopping."
    break
  fi

  ACTION_PRI=$(echo "$NEXT_ACTION" | cut -f1)
  ACTION_CAT=$(echo "$NEXT_ACTION" | cut -f2)
  ACTION_DESC=$(echo "$NEXT_ACTION" | cut -f3-)

  echo ""
  echo "── Iteration $ITERATION/$MAX_ITERATIONS (${ELAPSED}m elapsed) ──"
  echo "Action: [$ACTION_PRI] ($ACTION_CAT) $ACTION_DESC"
  echo "Current score: $CURRENT_SCORE"

  # Output the action plan as JSON for the calling agent
  # The agent reads this, makes one atomic change, then signals back
  PLAN_JSON=$(python3 -c "
import json, datetime
plan = {
    'iteration': $ITERATION,
    'skill': '$SKILL_NAME',
    'skill_file': '$SKILL_FILE',
    'action': {
        'priority': '$ACTION_PRI',
        'category': '$ACTION_CAT',
        'description': $(python3 -c "import json; print(json.dumps('$ACTION_DESC'))")
    },
    'current_score': float('$CURRENT_SCORE'),
    'constraints': [],
    'timestamp': datetime.datetime.now().isoformat()
}
# Load constraints
with open('$CONSTRAINTS_FILE') as f:
    plan['constraints'] = [line.strip() for line in f if line.strip()]
print(json.dumps(plan))
" 2>/dev/null)

  echo "PLAN:$PLAN_JSON"

  # Wait for the agent to signal completion by creating a marker file
  MARKER="$SKILL_DIR/.improve-done"
  REVERT_MARKER="$SKILL_DIR/.improve-skip"
  rm -f "$MARKER" "$REVERT_MARKER"

  echo "WAITING_FOR_AGENT"

  # In non-interactive mode, we just output the plan and exit after each iteration
  # The calling process (skill-improve command or afk-housekeeping) handles the loop
  # by calling improve-loop.sh repeatedly or reading the plan output

  # For batch mode: if the agent has already made changes (marker exists), verify
  if [ -f "$MARKER" ]; then
    rm -f "$MARKER"

    # Run test suite
    NEW_RESULT=$("$SCRIPT_DIR/test-runner.sh" "$SKILL_DIR" 2>/dev/null)
    NEW_SCORE=$(echo "$NEW_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('score', 0))" 2>/dev/null || echo "0")

    # Compare
    IMPROVED=$(python3 -c "
old = float('$CURRENT_SCORE')
new = float('$NEW_SCORE')
direction = '$DIRECTION'
if direction == 'higher_is_better':
    print('yes' if new > old else ('same' if new == old else 'no'))
else:
    print('yes' if new < old else ('same' if new == old else 'no'))
" 2>/dev/null || echo "no")

    if [ "$IMPROVED" = "yes" ]; then
      echo "KEPT: Score improved $CURRENT_SCORE → $NEW_SCORE"
      KEPT=$((KEPT + 1))

      # Log improvement
      python3 -c "
import json, datetime
entry = {
    'iteration': $ITERATION,
    'action_priority': '$ACTION_PRI',
    'category': '$ACTION_CAT',
    'action': $(python3 -c "import json; print(json.dumps('$ACTION_DESC'))"),
    'score_before': float('$CURRENT_SCORE'),
    'score_after': float('$NEW_SCORE'),
    'delta': round(float('$NEW_SCORE') - float('$CURRENT_SCORE'), 2),
    'result': 'kept',
    'timestamp': datetime.datetime.now().isoformat()
}
print(json.dumps(entry))
" >> "$IMPROVEMENTS_LOG"

      CURRENT_SCORE="$NEW_SCORE"
      LAST_CAT_2="$LAST_CAT_1"
      LAST_CAT_1="$ACTION_CAT"

    elif [ "$IMPROVED" = "same" ]; then
      echo "KEPT (neutral): Score unchanged at $CURRENT_SCORE"
      KEPT=$((KEPT + 1))

      python3 -c "
import json, datetime
entry = {
    'iteration': $ITERATION,
    'action_priority': '$ACTION_PRI',
    'category': '$ACTION_CAT',
    'action': $(python3 -c "import json; print(json.dumps('$ACTION_DESC'))"),
    'score_before': float('$CURRENT_SCORE'),
    'score_after': float('$NEW_SCORE'),
    'delta': 0,
    'result': 'kept_neutral',
    'timestamp': datetime.datetime.now().isoformat()
}
print(json.dumps(entry))
" >> "$IMPROVEMENTS_LOG"

      LAST_CAT_2="$LAST_CAT_1"
      LAST_CAT_1="$ACTION_CAT"

    else
      echo "REVERT: Score regressed $CURRENT_SCORE → $NEW_SCORE"
      REVERTED=$((REVERTED + 1))

      # Log reversion
      python3 -c "
import json, datetime
entry = {
    'iteration': $ITERATION,
    'action_priority': '$ACTION_PRI',
    'category': '$ACTION_CAT',
    'action': $(python3 -c "import json; print(json.dumps('$ACTION_DESC'))"),
    'score_before': float('$CURRENT_SCORE'),
    'score_after': float('$NEW_SCORE'),
    'delta': round(float('$NEW_SCORE') - float('$CURRENT_SCORE'), 2),
    'result': 'reverted',
    'timestamp': datetime.datetime.now().isoformat()
}
print(json.dumps(entry))
" >> "$IMPROVEMENTS_LOG"

      echo "REVERT_NEEDED"
    fi

  elif [ -f "$REVERT_MARKER" ]; then
    rm -f "$REVERT_MARKER"
    SKIPPED=$((SKIPPED + 1))
    echo "SKIPPED by agent"

    python3 -c "
import json, datetime
entry = {
    'iteration': $ITERATION,
    'action_priority': '$ACTION_PRI',
    'category': '$ACTION_CAT',
    'action': $(python3 -c "import json; print(json.dumps('$ACTION_DESC'))"),
    'score_before': float('$CURRENT_SCORE'),
    'score_after': float('$CURRENT_SCORE'),
    'delta': 0,
    'result': 'skipped',
    'timestamp': datetime.datetime.now().isoformat()
}
print(json.dumps(entry))
" >> "$IMPROVEMENTS_LOG"
  else
    # No marker — we're in plan-output mode. Break after outputting the plan.
    break
  fi
done

# ── Summary ──
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Improvement Loop Complete: $SKILL_NAME"
echo "║  Iterations: $ITERATION"
echo "║  Kept: $KEPT | Reverted: $REVERTED | Skipped: $SKIPPED"
echo "║  Score: $BASELINE_SCORE → $CURRENT_SCORE"
echo "╚══════════════════════════════════════════════╝"

# Output final summary as JSON
python3 -c "
import json
summary = {
    'skill': '$SKILL_NAME',
    'iterations': $ITERATION,
    'kept': $KEPT,
    'reverted': $REVERTED,
    'skipped': $SKIPPED,
    'baseline_score': float('$BASELINE_SCORE'),
    'final_score': float('$CURRENT_SCORE'),
    'delta': round(float('$CURRENT_SCORE') - float('$BASELINE_SCORE'), 2),
    'mode': '$MODE',
    'time_elapsed_min': $(( ($(date +%s) - START_TIME) / 60 ))
}
print(json.dumps(summary))
"

# Cleanup
rm -f "$CONSTRAINTS_FILE" "$ACTIONS_FILE"
