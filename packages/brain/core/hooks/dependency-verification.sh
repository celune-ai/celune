#!/bin/bash

# Claude Code PreToolUse hook — intercepts package install commands
# and runs verify-dependency.mjs before allowing them.
# Sends an HTTP notification to the admin dashboard when a dep install is denied.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_AGENT="${HOOK_AGENT:-lead}"
HOOK_ADMIN_URL="${HOOK_ADMIN_URL:-http://localhost:3002}"
HOOK_SECRET="${HOOK_SECRET:-}"

# Lazily source HOOK_SECRET from .env.local if not already set
if [ -z "$HOOK_SECRET" ] && [ -f "$SCRIPT_DIR/../../apps/platform/.env.local" ]; then
  HOOK_SECRET=$(grep '^HOOK_SECRET=' "$SCRIPT_DIR/../../apps/platform/.env.local" | cut -d'=' -f2- || true)
fi

# Read JSON input from stdin
input=$(cat)

# Extract the bash command
command=$(echo "$input" | jq -r '.tool_input.command // empty')

if [ -z "$command" ]; then
  exit 0
fi

# Check if this is a package install command
if echo "$command" | grep -qE '(pnpm\s+add|npm\s+install|npm\s+i|yarn\s+add)\s'; then
  # Extract the project root from cwd
  cwd=$(echo "$input" | jq -r '.cwd // empty')
  script_dir="$(cd "$(dirname "$0")/../.." && pwd)"

  # Run the verification script in --command mode
  result=$(node "$script_dir/scripts/verify-dependency.mjs" --command "$command" 2>&1)
  exit_code=$?

  if [ $exit_code -ne 0 ]; then
    # Notify admin dashboard asynchronously (fire and forget)
    safe_cmd=$(echo "$command" | head -c 200)
    curl -sf \
      -X POST \
      -H "Content-Type: application/json" \
      -H "X-Hook-Secret: ${HOOK_SECRET}" \
      -d "{\"event\":\"dep.denied\",\"severity\":\"warning\",\"source\":\"${HOOK_AGENT}\",\"agent_id\":\"${HOOK_AGENT}\",\"title\":\"Dep install blocked: ${safe_cmd}\",\"details\":{\"command\":\"${safe_cmd}\"}}" \
      "${HOOK_ADMIN_URL}/api/hooks/notify" \
      --max-time 3 \
      > /dev/null 2>&1 &

    # Deny the command — verification failed
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Dependency verification failed:\\n$result\\n\\nRun 'node scripts/verify-dependency.mjs <pkg>' to check packages manually."
  }
}
EOF
    exit 0
  fi
fi

# Allow everything else
exit 0
