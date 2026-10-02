#!/usr/bin/env bash
# benchmark-report.sh — Generate a benchmarking report for all skills.
# Shows scores, improvement history, and identifies skills needing attention.
# This file is LOCKED. Agents MUST NOT modify it.
#
# Usage: benchmark-report.sh [--format json|markdown|summary] [--sort score|name|delta]
#
# Output formats:
#   json     — Full JSON report (for Supabase/dashboard)
#   markdown — Formatted markdown table (for session logs)
#   summary  — One-line-per-skill (for quick scans)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$(dirname "$SCRIPT_DIR")"
FORMAT="markdown"
SORT="score"

while [ $# -gt 0 ]; do
  case "$1" in
    --format) FORMAT="$2"; shift 2 ;;
    --sort) SORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Collect data for all skills
RESULTS_FILE=$(mktemp)
trap 'rm -f "$RESULTS_FILE"' EXIT
echo "[" > "$RESULTS_FILE"
FIRST=true

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  [ "$skill_name" = "_framework" ] && continue
  [ "$skill_name" = "_templates" ] && continue

  # Must have a skill file
  SKILL_FILE=""
  [ -f "$skill_dir/SKILL.md" ] && SKILL_FILE="$skill_dir/SKILL.md"
  [ -f "$skill_dir/CLAUDE.md" ] && SKILL_FILE="$skill_dir/CLAUDE.md"
  [ -z "$SKILL_FILE" ] && continue

  # Run test suite
  RESULT=$("$SCRIPT_DIR/test-runner.sh" "$skill_dir" 2>/dev/null || echo '{"score":0,"structure_score":0,"clarity_score":0,"completeness_score":0}')

  # Get improvement history
  ITERATIONS=0
  KEPT=0
  REVERTED=0
  BEST_SCORE=0
  LAST_IMPROVED="never"
  if [ -f "$skill_dir/improvements.jsonl" ] && [ -s "$skill_dir/improvements.jsonl" ]; then
    ITERATIONS=$(wc -l < "$skill_dir/improvements.jsonl" | tr -d ' ')
    KEPT=$(grep -c '"kept"' "$skill_dir/improvements.jsonl" 2>/dev/null || echo "0")
    REVERTED=$(grep -c '"reverted"' "$skill_dir/improvements.jsonl" 2>/dev/null || echo "0")
    LAST_IMPROVED=$(tail -1 "$skill_dir/improvements.jsonl" | python3 -c "import sys,json; print(json.load(sys.stdin).get('timestamp','unknown')[:10])" 2>/dev/null || echo "unknown")
    BEST_SCORE=$(python3 -c "
import json
best = 0
with open('$skill_dir/improvements.jsonl') as f:
    for line in f:
        if line.strip():
            try:
                d = json.loads(line)
                s = d.get('score_after', 0)
                if s > best: best = s
            except: pass
print(best)
" 2>/dev/null || echo "0")
  fi

  # Get complexity from GOAL.md
  COMPLEXITY="unknown"
  if [ -f "$skill_dir/GOAL.md" ]; then
    COMPLEXITY=$(grep "^Complexity:" "$skill_dir/GOAL.md" 2>/dev/null | head -1 | sed 's/Complexity: *//' | cut -d' ' -f1 || echo "unknown")
  fi

  # Has GOAL.md?
  HAS_GOAL="false"
  [ -f "$skill_dir/GOAL.md" ] && HAS_GOAL="true"

  # Add to results
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo "," >> "$RESULTS_FILE"
  fi

  python3 -c "
import json, sys
result = json.loads('''$RESULT''')
entry = {
    'skill': '$skill_name',
    'score': result.get('score', 0),
    'structure_score': result.get('structure_score', 0),
    'clarity_score': result.get('clarity_score', 0),
    'completeness_score': result.get('completeness_score', 0),
    'has_goal': '$HAS_GOAL' == 'true',
    'complexity': '$COMPLEXITY',
    'iterations': int('$ITERATIONS'),
    'kept': int('$KEPT'),
    'reverted': int('$REVERTED'),
    'best_score': float('$BEST_SCORE'),
    'last_improved': '$LAST_IMPROVED'
}
print(json.dumps(entry))
" >> "$RESULTS_FILE"
done

echo "]" >> "$RESULTS_FILE"

# Sort and format
case "$FORMAT" in

json)
  python3 -c "
import json, sys
with open('$RESULTS_FILE') as f:
    data = json.load(f)
sort_key = '$SORT'
if sort_key == 'score':
    data.sort(key=lambda x: x['score'], reverse=True)
elif sort_key == 'name':
    data.sort(key=lambda x: x['skill'])
elif sort_key == 'delta':
    data.sort(key=lambda x: x['best_score'] - x['score'], reverse=True)

report = {
    'generated': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'total_skills': len(data),
    'avg_score': round(sum(d['score'] for d in data) / len(data), 1) if data else 0,
    'skills_above_50': sum(1 for d in data if d['score'] >= 50),
    'skills_below_30': sum(1 for d in data if d['score'] < 30),
    'total_iterations': sum(d['iterations'] for d in data),
    'skills': data
}
print(json.dumps(report, indent=2))
"
  ;;

markdown)
  python3 -c "
import json
with open('$RESULTS_FILE') as f:
    data = json.load(f)
sort_key = '$SORT'
if sort_key == 'score':
    data.sort(key=lambda x: x['score'], reverse=True)
elif sort_key == 'name':
    data.sort(key=lambda x: x['skill'])

total = len(data)
avg = round(sum(d['score'] for d in data) / total, 1) if total else 0
above_50 = sum(1 for d in data if d['score'] >= 50)
below_30 = sum(1 for d in data if d['score'] < 30)

print(f'## Skill Benchmarking Report')
print(f'')
print(f'Generated: $(date +%Y-%m-%d)')
print(f'')
print(f'| Metric | Value |')
print(f'|--------|-------|')
print(f'| Total skills | {total} |')
print(f'| Average score | {avg} |')
print(f'| Skills ≥ 50 | {above_50} |')
print(f'| Skills < 30 | {below_30} |')
print(f'')
print(f'| Skill | Score | Structure | Clarity | Completeness | Iterations | Status |')
print(f'|-------|-------|-----------|---------|--------------|------------|--------|')
for d in data:
    status = '✓' if d['score'] >= 50 else ('⚠' if d['score'] >= 30 else '✗')
    iter_str = str(d['iterations']) if d['iterations'] > 0 else '-'
    print(f\"| {d['skill']} | {d['score']} | {d['structure_score']} | {d['clarity_score']} | {d['completeness_score']} | {iter_str} | {status} |\")

print(f'')
print(f'### Needs Attention (score < 30)')
print(f'')
low = [d for d in data if d['score'] < 30]
if low:
    for d in low:
        weakest = 'clarity' if d['clarity_score'] <= d['structure_score'] and d['clarity_score'] <= d['completeness_score'] else ('completeness' if d['completeness_score'] <= d['structure_score'] else 'structure')
        print(f\"- **{d['skill']}** ({d['score']}) — weakest: {weakest}\")
else:
    print('None — all skills score ≥ 30')
"
  ;;

summary)
  python3 -c "
import json
with open('$RESULTS_FILE') as f:
    data = json.load(f)
data.sort(key=lambda x: x['score'], reverse=True)
for d in data:
    status = 'OK' if d['score'] >= 50 else ('WARN' if d['score'] >= 30 else 'LOW')
    print(f\"{d['skill']:25s} {d['score']:5.1f}  [{status}]  iter={d['iterations']}\")
"
  ;;

esac

rm -f "$RESULTS_FILE"
