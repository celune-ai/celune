#!/bin/bash
# pre-compact.sh — Pre-compaction recovery hook
#
# Captures critical session state before context compaction:
# 1. Active task IDs and status
# 2. Git state (branch, uncommitted changes, recent commits)
# 3. Current working context
#
# Writes a structured recovery file that post-compact reads to restore context.
# Also persists a handoff entry to agent_memory (category=handoff) for durability.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Output file
RECOVERY_DIR="$HOME/.claude/state"
mkdir -p "$RECOVERY_DIR"
RECOVERY_FILE="$RECOVERY_DIR/pre-compact-recovery.json"

# Temp files for safe data passing (avoids shell injection via Python heredocs)
TMPDIR_SAFE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_SAFE"' EXIT

# Source env vars
ENV_FILE="$MONOREPO_ROOT/apps/platform/.env.local"
SUPABASE_URL=""
SERVICE_KEY=""
if [ -f "$ENV_FILE" ]; then
  SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d'=' -f2- || true)
  SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d'=' -f2- || true)
fi

# --- Capture git state to temp files ---
git -C "$MONOREPO_ROOT" branch --show-current 2>/dev/null > "$TMPDIR_SAFE/branch" || echo "unknown" > "$TMPDIR_SAFE/branch"
git -C "$MONOREPO_ROOT" status --short 2>/dev/null | head -20 > "$TMPDIR_SAFE/status" || true
git -C "$MONOREPO_ROOT" diff --stat 2>/dev/null | tail -1 > "$TMPDIR_SAFE/diff_stat" || true
git -C "$MONOREPO_ROOT" log --oneline -5 2>/dev/null > "$TMPDIR_SAFE/log" || true

# --- Capture active tasks ---
echo "[]" > "$TMPDIR_SAFE/tasks"
if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ]; then
  curl -sf \
    "${SUPABASE_URL}/rest/v1/tasks?status=eq.in_progress&select=id,title,assignee,project_id,metadata" \
    -H @- <<HDRS --max-time 3 > "$TMPDIR_SAFE/tasks" 2>/dev/null || true
apikey: ${SERVICE_KEY}
Authorization: Bearer ${SERVICE_KEY}
HDRS
fi

# --- Read active workspace/project ---
WORKSPACE_ID=""
WORKSPACE_STATE="$HOME/.claude/state/active-workspace.json"
if [ -f "$WORKSPACE_STATE" ]; then
  WORKSPACE_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('workspace_id',''))" "$WORKSPACE_STATE" 2>/dev/null || true)
fi

PROJECT_ID=""
PROJECT_STATE="$HOME/.claude/state/active-project.json"
if [ -f "$PROJECT_STATE" ]; then
  PROJECT_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('project_id',''))" "$PROJECT_STATE" 2>/dev/null || true)
fi

# --- Build recovery JSON using temp files (no shell var interpolation in Python) ---
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

python3 - "$TIMESTAMP" "$WORKSPACE_ID" "$PROJECT_ID" "$TMPDIR_SAFE" "$RECOVERY_FILE" << 'PYEOF'
import json, sys, os

timestamp, workspace_id, project_id, tmpdir, recovery_file = sys.argv[1:6]

def read_file(name):
    path = os.path.join(tmpdir, name)
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return ""

def read_json(name):
    content = read_file(name)
    try:
        return json.loads(content) if content else []
    except json.JSONDecodeError:
        return []

recovery = {
    "timestamp": timestamp,
    "workspace_id": workspace_id,
    "project_id": project_id,
    "git": {
        "branch": read_file("branch"),
        "uncommitted_changes": read_file("status"),
        "diff_summary": read_file("diff_stat"),
        "recent_commits": read_file("log"),
    },
    "active_tasks": read_json("tasks"),
}

with open(recovery_file, "w") as f:
    json.dump(recovery, f, indent=2)

print(json.dumps(recovery, indent=2))
PYEOF

# --- Persist to agent_memory for cross-session durability ---
if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ]; then
  MEMORY_KEY="handoff-$(date -u +%Y%m%d-%H%M%S)"

  # Build memory content safely via Python reading the recovery file
  python3 - "$RECOVERY_FILE" > "$TMPDIR_SAFE/memory_payload.json" << 'PYEOF2'
import json, sys

with open(sys.argv[1]) as f:
    r = json.load(f)

tasks_str = ", ".join([t.get("title", "?")[:40] for t in r.get("active_tasks", [])])
content = f"""## Pre-Compaction Handoff — {r['timestamp']}
Branch: {r['git']['branch']}
Active tasks: {tasks_str or 'None'}
Uncommitted: {r['git']['uncommitted_changes'][:200] or 'Clean'}
Recent commits: {r['git']['recent_commits'][:300]}"""

print(json.dumps(content))
PYEOF2

  MEMORY_CONTENT=$(cat "$TMPDIR_SAFE/memory_payload.json")

  # Upsert to agent_memory using temp file for payload
  printf '{"key":"%s","category":"handoff","content":%s,"source":"pre-compact-hook"}' \
    "$MEMORY_KEY" "$MEMORY_CONTENT" > "$TMPDIR_SAFE/upsert_body.json"

  curl -sf -X POST \
    "${SUPABASE_URL}/rest/v1/agent_memory" \
    -H @- <<HDRS2 \
    -d @"$TMPDIR_SAFE/upsert_body.json" \
    --max-time 3 > /dev/null 2>&1 || true
apikey: ${SERVICE_KEY}
Authorization: Bearer ${SERVICE_KEY}
Content-Type: application/json
HDRS2
fi

echo "PRE_COMPACT_RECOVERY: State saved to $RECOVERY_FILE"
