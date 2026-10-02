#!/usr/bin/env bash
# completeness.sh — Measure edge case coverage and error handling completeness.
# Checks: error handling mentions, edge cases, validation, failure modes.
# Output: single integer score (0-100) to stdout.
# This file is LOCKED. Agents MUST NOT modify it.

set -euo pipefail

SKILL_FILE="${1:?Usage: completeness.sh <skill-file>}"

if [ ! -f "$SKILL_FILE" ]; then
  echo "0"
  exit 0
fi

content=$(cat "$SKILL_FILE")

score=0
max_points=0

# ── 1. Mentions error handling / failure modes (20 points) ──
max_points=$((max_points + 20))
error_refs=$(echo "$content" | grep -ciE '\berror|fail|exception|invalid|missing|timeout|retry|rollback|revert\b' 2>/dev/null || echo "0")
if [ "$error_refs" -ge 5 ]; then
  score=$((score + 20))
elif [ "$error_refs" -ge 3 ]; then
  score=$((score + 12))
elif [ "$error_refs" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 2. Has edge case section or mentions edge cases (15 points) ──
max_points=$((max_points + 15))
edge_section=$(echo "$content" | grep -ciE '^#{1,3}.*[Ee]dge [Cc]ase|^#{1,3}.*[Ss]pecial [Cc]ase|^#{1,3}.*[Ee]xception' 2>/dev/null || echo "0")
edge_mentions=$(echo "$content" | grep -ciE '\bedge case|corner case|special case|boundary\b' 2>/dev/null || echo "0")
if [ "$edge_section" -gt 0 ]; then
  score=$((score + 15))
elif [ "$edge_mentions" -ge 2 ]; then
  score=$((score + 10))
elif [ "$edge_mentions" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 3. Input validation mentions (15 points) ──
max_points=$((max_points + 15))
validation_refs=$(echo "$content" | grep -ciE '\bvalidat|sanitiz|check.*input|verify.*param|required.*field|must.*be|must.*have\b' 2>/dev/null || echo "0")
if [ "$validation_refs" -ge 3 ]; then
  score=$((score + 15))
elif [ "$validation_refs" -ge 1 ]; then
  score=$((score + 8))
fi

# ── 4. Has sequence/dependency information (15 points) ──
max_points=$((max_points + 15))
seq_refs=$(echo "$content" | grep -ciE '\b[Ss]equence|[Dd]epend|[Bb]lock|[Pp]rerequisit|before.*this|after.*this|must.*first\b' 2>/dev/null || echo "0")
if [ "$seq_refs" -ge 3 ]; then
  score=$((score + 15))
elif [ "$seq_refs" -ge 1 ]; then
  score=$((score + 8))
fi

# ── 5. Security considerations mentioned (10 points) ──
max_points=$((max_points + 10))
security_refs=$(echo "$content" | grep -ciE '\bsecur|auth|permission|access|token|secret|encrypt|RLS|injection|XSS\b' 2>/dev/null || echo "0")
if [ "$security_refs" -ge 2 ]; then
  score=$((score + 10))
elif [ "$security_refs" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 6. Has conditional logic / branching (if/else paths) (10 points) ──
max_points=$((max_points + 10))
conditional_refs=$(echo "$content" | grep -ciE '\bif.*then|else|otherwise|when.*is|unless|except when|in case\b' 2>/dev/null || echo "0")
if [ "$conditional_refs" -ge 3 ]; then
  score=$((score + 10))
elif [ "$conditional_refs" -ge 1 ]; then
  score=$((score + 5))
fi

# ── 7. Mentions testing or verification (15 points) ──
max_points=$((max_points + 15))
test_refs=$(echo "$content" | grep -ciE '\btest|verify|assert|check|confirm|ensure|validate|QA\b' 2>/dev/null || echo "0")
if [ "$test_refs" -ge 3 ]; then
  score=$((score + 15))
elif [ "$test_refs" -ge 1 ]; then
  score=$((score + 8))
fi

# Normalize to 0-100
if [ "$max_points" -gt 0 ]; then
  final_score=$(( (score * 100) / max_points ))
else
  final_score=0
fi

echo "$final_score"
