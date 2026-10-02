#!/usr/bin/env bash
# context-audit.sh — Audit context window footprint across all skills.
# Shows line counts, estimated tokens, context-cost scores, and layering status.
#
# Usage: context-audit.sh [--skills-dir <path>] [--format summary|markdown]
#
# Default skills directory: ~/.claude/skills

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="${HOME}/.claude/skills"
FORMAT="markdown"

while [ $# -gt 0 ]; do
  case "$1" in
    --skills-dir) SKILLS_DIR="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

python3 -c "
import os, subprocess, json

skills_dir = '$SKILLS_DIR'
metric_script = '$SCRIPT_DIR/metrics/context-cost.sh'
fmt = '$FORMAT'

results = []
total_lines = 0
total_ref_lines = 0

for skill_name in sorted(os.listdir(skills_dir)):
    skill_dir = os.path.join(skills_dir, skill_name)
    if not os.path.isdir(skill_dir):
        continue
    if skill_name.startswith('_'):
        continue

    skill_file = os.path.join(skill_dir, 'SKILL.md')
    if not os.path.exists(skill_file):
        skill_file = os.path.join(skill_dir, 'CLAUDE.md')
    if not os.path.exists(skill_file):
        continue

    # Count lines
    with open(skill_file) as f:
        lines = len(f.readlines())

    # Count ref lines
    refs_dir = os.path.join(skill_dir, 'refs')
    ref_lines = 0
    ref_count = 0
    if os.path.isdir(refs_dir):
        for rf in os.listdir(refs_dir):
            if rf.endswith('.md'):
                ref_count += 1
                with open(os.path.join(refs_dir, rf)) as f:
                    ref_lines += len(f.readlines())

    # Run context-cost metric
    try:
        score = int(subprocess.check_output(
            ['bash', metric_script, skill_file],
            stderr=subprocess.DEVNULL
        ).decode().strip())
    except:
        score = 0

    est_tokens = lines * 4  # rough estimate: 4 tokens per line

    results.append({
        'skill': skill_name,
        'lines': lines,
        'tokens': est_tokens,
        'score': score,
        'refs': ref_count,
        'ref_lines': ref_lines,
        'layered': ref_count > 0,
    })
    total_lines += lines
    total_ref_lines += ref_lines

# Sort by lines descending
results.sort(key=lambda x: x['lines'], reverse=True)

if fmt == 'markdown':
    print('## Context Window Audit')
    print()
    avg_score = sum(r['score'] for r in results) / len(results) if results else 0
    print(f'| Metric | Value |')
    print(f'|--------|-------|')
    print(f'| Total skills | {len(results)} |')
    print(f'| Total core lines | {total_lines} |')
    print(f'| Total ref lines | {total_ref_lines} |')
    print(f'| Est. tokens (core) | ~{total_lines * 4:,} |')
    print(f'| Avg context-cost score | {avg_score:.0f} |')
    print(f'| Skills with refs/ | {sum(1 for r in results if r[\"layered\"])} |')
    print()
    print('| Skill | Lines | ~Tokens | Score | Refs | Layered |')
    print('|-------|-------|---------|-------|------|---------|')
    for r in results:
        layered = 'Yes' if r['layered'] else '-'
        refs = str(r['refs']) if r['refs'] > 0 else '-'
        indicator = '!' if r['score'] <= 25 else ('~' if r['score'] <= 50 else ' ')
        print(f\"| {r['skill']}{indicator}| {r['lines']} | ~{r['tokens']} | {r['score']} | {refs} | {layered} |\")
else:
    for r in results:
        status = 'OK' if r['score'] >= 70 else ('WARN' if r['score'] >= 50 else 'HIGH')
        layered = 'layered' if r['layered'] else 'flat'
        print(f\"{r['skill']:25s} {r['lines']:4d} lines  ~{r['tokens']:5d} tok  score={r['score']:3d}  [{status}]  {layered}\")
    print(f'---')
    print(f'Total: {total_lines} core lines, ~{total_lines * 4} tokens')
"
