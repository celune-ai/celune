#!/bin/bash

# Claude Code PreToolUse hook — intercepts Write/Edit tool calls targeting
# package.json files and verifies any new dependency names before allowing them.
# Sends an HTTP notification to the admin dashboard when a dep write is denied.

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

# Extract tool name and file path
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Only care about package.json files
if [[ ! "$file_path" =~ package\.json$ ]]; then
  exit 0
fi

script_dir="$(cd "$(dirname "$0")/../.." && pwd)"
verify_script="$script_dir/scripts/verify-dependency.mjs"

if [ ! -f "$verify_script" ]; then
  # Can't verify without the script — allow and warn
  echo "Warning: verify-dependency.mjs not found, skipping dep check" >&2
  exit 0
fi

new_packages=()

if [ "$tool_name" = "Write" ]; then
  # Full file write — parse content as JSON, extract all dep names
  content=$(echo "$input" | jq -r '.tool_input.content // empty')
  if [ -z "$content" ]; then
    exit 0
  fi

  # Extract package names from dependencies and devDependencies
  deps=$(echo "$content" | jq -r '
    ((.dependencies // {}) | keys[]) ,
    ((.devDependencies // {}) | keys[])
  ' 2>/dev/null)

  if [ -z "$deps" ]; then
    exit 0
  fi

  while IFS= read -r pkg; do
    [ -n "$pkg" ] && new_packages+=("$pkg")
  done <<< "$deps"

elif [ "$tool_name" = "Edit" ]; then
  # Partial edit — find package names in new_string not present in old_string
  old_string=$(echo "$input" | jq -r '.tool_input.old_string // empty')
  new_string=$(echo "$input" | jq -r '.tool_input.new_string // empty')

  if [ -z "$new_string" ]; then
    exit 0
  fi

  # Extract quoted package name patterns (e.g. "lodash": or "@scope/pkg":)
  old_pkgs=$(echo "$old_string" | grep -oE '"(@[a-zA-Z0-9_-]+/)?[a-zA-Z0-9_@./-]+"\s*:' | sed 's/"\s*:$//' | sed 's/^"//' | sort -u)
  new_pkgs=$(echo "$new_string" | grep -oE '"(@[a-zA-Z0-9_-]+/)?[a-zA-Z0-9_@./-]+"\s*:' | sed 's/"\s*:$//' | sed 's/^"//' | sort -u)

  # Find packages in new but not in old
  if [ -n "$new_pkgs" ]; then
    while IFS= read -r pkg; do
      if [ -n "$pkg" ] && ! echo "$old_pkgs" | grep -qxF "$pkg"; then
        new_packages+=("$pkg")
      fi
    done <<< "$new_pkgs"
  fi
fi

# Nothing to verify
if [ ${#new_packages[@]} -eq 0 ]; then
  exit 0
fi

# Run verification on discovered packages
result=$(node "$verify_script" "${new_packages[@]}" 2>&1)
exit_code=$?

if [ $exit_code -ne 0 ]; then
  # Notify admin dashboard asynchronously (fire and forget)
  pkgs_list="${new_packages[*]}"
  curl -sf \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Hook-Secret: ${HOOK_SECRET}" \
    -d "{\"event\":\"dep.denied\",\"severity\":\"warning\",\"source\":\"${HOOK_AGENT}\",\"agent_id\":\"${HOOK_AGENT}\",\"title\":\"Dep write blocked in package.json\",\"details\":{\"packages\":\"${pkgs_list}\",\"file\":\"${file_path}\"}}" \
    "${HOOK_ADMIN_URL}/api/hooks/notify" \
    --max-time 3 \
    > /dev/null 2>&1 &

  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Dependency verification failed for package.json edit:\\n$result\\n\\nRun 'node scripts/verify-dependency.mjs <pkg>' to check packages manually."
  }
}
EOF
  exit 0
fi

# All packages passed
exit 0
