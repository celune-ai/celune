#!/bin/bash
# session-start.sh — SessionStart hook
#
# 1. Notifies the admin dashboard via HTTP that a new agent session has started.
# 2. Checks for pending CORE brain updates and auto-applies non-forked ones.
# 3. Checks Supabase for initiated tasks and surfaces them as a user message.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Source env vars
ENV_FILE="$MONOREPO_ROOT/apps/platform/.env.local"
if [ -f "$ENV_FILE" ]; then
  SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | cut -d'=' -f2- || true)
  SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d'=' -f2- || true)
  HOOK_SECRET_ENV=$(grep '^HOOK_SECRET=' "$ENV_FILE" | cut -d'=' -f2- || true)
fi

# --- HTTP notification to admin dashboard ---
HOOK_AGENT="${HOOK_AGENT:-lead}"
HOOK_ADMIN_URL="${HOOK_ADMIN_URL:-http://localhost:3002}"
HOOK_SECRET="${HOOK_SECRET:-${HOOK_SECRET_ENV:-}}"

payload=$(printf '{"event":"session.start","severity":"info","source":"%s","agent_id":"%s","title":"Session started: %s","details":{"message":"New Claude Code session initiated"}}' \
  "$HOOK_AGENT" "$HOOK_AGENT" "$HOOK_AGENT")

curl -sf \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hook-Secret: ${HOOK_SECRET}" \
  -d "$payload" \
  "${HOOK_ADMIN_URL}/api/hooks/notify" \
  --max-time 3 \
  > /dev/null 2>&1 || true

# --- CORE brain update check ---
# Read workspace_id from active-workspace state file
WORKSPACE_STATE="$HOME/.claude/state/active-workspace.json"
WORKSPACE_ID=""
if [ -f "$WORKSPACE_STATE" ]; then
  WORKSPACE_ID=$(python3 -c "import json; print(json.load(open('$WORKSPACE_STATE')).get('workspace_id',''))" 2>/dev/null || true)
fi

if [ -n "$WORKSPACE_ID" ]; then
  # Run brain update check in background subshell to avoid blocking session start
  (
    node "$MONOREPO_ROOT/packages/db/scripts/brain-apply-updates.mjs" \
      --workspace-id "$WORKSPACE_ID" \
      --env-path "$ENV_FILE" \
      2>&1 || true
  ) &
  BRAIN_PID=$!

  # Wait up to 3 seconds for brain update check, then move on
  ( sleep 3 && kill "$BRAIN_PID" 2>/dev/null ) &
  TIMEOUT_PID=$!
  wait "$BRAIN_PID" 2>/dev/null || true
  kill "$TIMEOUT_PID" 2>/dev/null || true
  wait "$TIMEOUT_PID" 2>/dev/null || true

  # Run fork detection AFTER updates — files just auto-updated won't be flagged
  (
    node "$MONOREPO_ROOT/packages/db/scripts/brain-fork-check.mjs" \
      --workspace-id "$WORKSPACE_ID" \
      --env-path "$ENV_FILE" \
      2>&1 || true
  ) &
  FORK_PID=$!

  # Wait up to 2 seconds for fork check
  ( sleep 2 && kill "$FORK_PID" 2>/dev/null ) &
  FORK_TIMEOUT_PID=$!
  wait "$FORK_PID" 2>/dev/null || true
  kill "$FORK_TIMEOUT_PID" 2>/dev/null || true
  wait "$FORK_TIMEOUT_PID" 2>/dev/null || true
fi

# --- Initiated tasks check (legacy behavior retained) ---
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SERVICE_KEY:-}" ]; then
  exit 0
fi

RESPONSE=$(curl -s \
  "${SUPABASE_URL}/rest/v1/tasks?status=eq.in_progress&metadata->>initiated=eq.true&select=id,title,assignee,priority" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  2>/dev/null || echo "[]")

COUNT=$(echo "$RESPONSE" | python3 -c "import json,sys; data=json.loads(sys.stdin.read()); print(len(data))" 2>/dev/null || echo "0")

if [ "$COUNT" -gt 0 ]; then
  TASKS=$(echo "$RESPONSE" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
for t in data:
    print(f\"  - [{t['priority']}] {t['title']} (assigned: {t['assignee']}, id: {t['id'][:8]})\")
" 2>/dev/null)

  echo "INITIATED TASKS WAITING:"
  echo "$TASKS"
  echo ""
  echo "These tasks were initiated by the workspace owner via the admin dashboard."
  echo "Claim and work them with: node packages/db/scripts/task-cli.mjs claim <id> --agent lead"
fi
