#!/usr/bin/env bash
# clarity.sh — Measure instruction clarity and specificity.
# Checks: concrete vs vague language, actionable steps, file/command references.
# Output: single integer score (0-100) to stdout.
# This file is LOCKED. Agents MUST NOT modify it.

set -euo pipefail

SKILL_FILE="${1:?Usage: clarity.sh <skill-file>}"

if [ ! -f "$SKILL_FILE" ]; then
  echo "0"
  exit 0
fi

score=0
max_points=0

# ── 1. Contains specific file paths or commands (20 points) ──
max_points=$((max_points + 20))
# Look for paths like /foo/bar, ./foo, ~/foo, packages/foo, src/foo, or backtick-quoted commands
path_refs=$(grep -cE '[~/\.]/[a-zA-Z]|packages/|src/|apps/|scripts/' "$SKILL_FILE" 2>/dev/null || echo "0")
path_refs=$(echo "$path_refs" | tr -d '[:space:]')
cmd_refs=$(grep -c '`[a-z].*`' "$SKILL_FILE" 2>/dev/null || echo "0")
cmd_refs=$(echo "$cmd_refs" | tr -d '[:space:]')
total_refs=$((path_refs + cmd_refs))
if [ "$total_refs" -ge 5 ]; then
  score=$((score + 20))
elif [ "$total_refs" -ge 3 ]; then
  score=$((score + 15))
elif [ "$total_refs" -ge 1 ]; then
  score=$((score + 8))
fi

# ── 2. Actionable instructions (20 points) ──
max_points=$((max_points + 20))
# Count numbered steps OR descriptive headings with action verbs
action_steps=$(grep -cE '^[0-9]+\.\s*(Create|Run|Check|Add|Update|Remove|Delete|Set|Build|Write|Read|Verify|Test|Deploy|Install|Configure|Enable|Disable|Fix|Implement|Review|Merge|Push|Pull|Fetch|Query|Search|Filter|Sort|Map|Reduce|Parse|Extract|Generate|Validate|Ensure|Confirm|Assert|Log|Print|Output|Return|Send|Post|Get|Put|Patch|Claim|Complete|Skip|Stop|Start|Launch|Spawn|Execute)' "$SKILL_FILE" 2>/dev/null || echo "0")
action_steps=$(echo "$action_steps" | tr -d '[:space:]')
# Also count H2/H3/H4 headings with step patterns
action_headings=$(grep -cE '^#{2,4}\s+(Step|Phase|Check)\s+[0-9]|^#{2,4}\s+[0-9]+[a-z]?\.' "$SKILL_FILE" 2>/dev/null || echo "0")
action_headings=$(echo "$action_headings" | tr -d '[:space:]')
total_actions=$((action_steps + action_headings))
if [ "$total_actions" -ge 5 ]; then
  score=$((score + 20))
elif [ "$total_actions" -ge 3 ]; then
  score=$((score + 15))
elif [ "$total_actions" -ge 1 ]; then
  score=$((score + 8))
fi

# ── 3. Low vague language ratio (20 points) ──
max_points=$((max_points + 20))
# Count vague words/phrases
vague_count=$(grep -ciE '\b(should|might|could|maybe|perhaps|consider|possibly|generally|usually|sometimes|often|appropriate|suitable|relevant|etc\.)\b' "$SKILL_FILE" 2>/dev/null || echo "0")
vague_count=$(echo "$vague_count" | tr -d '[:space:]')
word_count=$(wc -w < "$SKILL_FILE" | tr -d ' ')
if [ "$word_count" -gt 0 ]; then
  # Vague ratio: vague words per 100 words
  vague_ratio=$(python3 -c "print(round(${vague_count} * 100 / ${word_count}, 1))" 2>/dev/null || echo "99")
  if python3 -c "exit(0 if float('${vague_ratio}') < 2.0 else 1)" 2>/dev/null; then
    score=$((score + 20))
  elif python3 -c "exit(0 if float('${vague_ratio}') < 4.0 else 1)" 2>/dev/null; then
    score=$((score + 12))
  elif python3 -c "exit(0 if float('${vague_ratio}') < 6.0 else 1)" 2>/dev/null; then
    score=$((score + 5))
  fi
fi

# ── 4. Contains concrete examples or code blocks (15 points) ──
max_points=$((max_points + 15))
code_blocks=$(grep -c '```' "$SKILL_FILE" 2>/dev/null || echo "0")
code_blocks=$(echo "$code_blocks" | tr -d '[:space:]')
example_refs=$(grep -ciE '\bexample|e\.g\.\b' "$SKILL_FILE" 2>/dev/null || echo "0")
example_refs=$(echo "$example_refs" | tr -d '[:space:]')
if [ "$code_blocks" -ge 4 ] || [ "$example_refs" -ge 3 ]; then
  score=$((score + 15))
elif [ "$code_blocks" -ge 2 ] || [ "$example_refs" -ge 1 ]; then
  score=$((score + 10))
elif [ "$code_blocks" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 5. Section headings are descriptive (not generic) (10 points) ──
max_points=$((max_points + 10))
# Generic headings: "Overview", "Introduction", "Details", "Notes"
generic_headings=$(grep -ciE '^#{1,3}\s*(Overview|Introduction|Details|Notes|Misc|Other|General)\s*$' "$SKILL_FILE" 2>/dev/null || echo "0")
generic_headings=$(echo "$generic_headings" | tr -d '[:space:]')
total_headings=$(grep -c '^#' "$SKILL_FILE" 2>/dev/null || echo "1")
total_headings=$(echo "$total_headings" | tr -d '[:space:]')
if [ "$generic_headings" -eq 0 ] && [ "$total_headings" -ge 3 ]; then
  score=$((score + 10))
elif [ "$generic_headings" -le 1 ]; then
  score=$((score + 5))
fi

# ── 6. Consistent formatting (15 points) ──
max_points=$((max_points + 15))
# Check for mix of bullet styles (- vs * vs +)
bullet_dash=$(grep -c '^[[:space:]]*- ' "$SKILL_FILE" 2>/dev/null || echo "0")
bullet_dash=$(echo "$bullet_dash" | tr -d '[:space:]')
bullet_star=$(grep -c '^[[:space:]]*\* ' "$SKILL_FILE" 2>/dev/null || echo "0")
bullet_star=$(echo "$bullet_star" | tr -d '[:space:]')
bullet_plus=$(grep -c '^[[:space:]]*+ ' "$SKILL_FILE" 2>/dev/null || echo "0")
bullet_plus=$(echo "$bullet_plus" | tr -d '[:space:]')
styles_used=0
[ "$bullet_dash" -gt 0 ] && styles_used=$((styles_used + 1))
[ "$bullet_star" -gt 0 ] && styles_used=$((styles_used + 1))
[ "$bullet_plus" -gt 0 ] && styles_used=$((styles_used + 1))
if [ "$styles_used" -le 1 ]; then
  score=$((score + 15))
elif [ "$styles_used" -eq 2 ]; then
  score=$((score + 8))
fi

# Normalize to 0-100
if [ "$max_points" -gt 0 ]; then
  final_score=$(( (score * 100) / max_points ))
else
  final_score=0
fi

echo "$final_score"
