#!/bin/bash
# post-compact.sh — Post-compaction recovery hook
#
# Reads the pre-compact recovery file and outputs a structured summary
# so the agent can restore context after context window compaction.
#
# Called by the context-management skill or session-start after compaction.

set -euo pipefail

RECOVERY_FILE="$HOME/.claude/state/pre-compact-recovery.json"

if [ ! -f "$RECOVERY_FILE" ]; then
  echo "No pre-compaction recovery file found. Starting fresh."
  exit 0
fi

# Check if recovery file is recent (< 2 hours old) using stat
if command -v stat >/dev/null 2>&1; then
  FILE_MOD=$(stat -f %m "$RECOVERY_FILE" 2>/dev/null || stat -c %Y "$RECOVERY_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s)
  FILE_AGE=$(( NOW - FILE_MOD ))

  if [ "$FILE_AGE" -gt 7200 ]; then
    echo "Recovery file is stale ($((FILE_AGE / 3600))h old). Skipping."
    rm -f "$RECOVERY_FILE"
    exit 0
  fi
fi

# Output structured recovery summary (Python reads file by path argument, no interpolation)
python3 - "$RECOVERY_FILE" << 'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    r = json.load(f)

print("## Post-Compaction Recovery")
print()
print(f"**Saved at:** {r['timestamp']}")
print(f"**Branch:** {r['git']['branch']}")
print(f"**Workspace:** {r.get('workspace_id', 'unknown')}")
if r.get("project_id"):
    print(f"**Project:** {r['project_id']}")
print()

tasks = r.get("active_tasks", [])
if tasks:
    print(f"### Active Tasks ({len(tasks)})")
    for t in tasks:
        tid = t.get("id", "?")[:8]
        title = t.get("title", "Unknown")
        assignee = t.get("assignee", "?")
        print(f"- [{tid}] {title} (assignee: {assignee})")
    print()

uncommitted = r["git"].get("uncommitted_changes", "").strip()
if uncommitted:
    print("### Uncommitted Changes")
    print("```")
    print(uncommitted[:500])
    print("```")
    print()

diff = r["git"].get("diff_summary", "").strip()
if diff:
    print(f"**Diff summary:** {diff}")
    print()

commits = r["git"].get("recent_commits", "").strip()
if commits:
    print("### Recent Commits")
    print("```")
    print(commits)
    print("```")

print()
print("Recovery file consumed. Re-read task descriptions and continue where you left off.")
PYEOF

# Clean up recovery file after consumption
rm -f "$RECOVERY_FILE"
