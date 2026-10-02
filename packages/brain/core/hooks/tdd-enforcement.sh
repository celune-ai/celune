#!/bin/bash

# Claude Code PreToolUse hook — advisory TDD enforcement
# Warns (but does not block) when editing implementation files without tests.
# Also sends an HTTP notification to the admin dashboard when a warning fires.

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

# Extract the target file path from tool_input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

if [ -z "$file_path" ]; then
  exit 0
fi

# Get just the filename and extension
filename=$(basename "$file_path")
extension="${filename##*.}"

# Skip non-implementation files: tests, configs, markdown, JSON, CSS, CLAUDE.md
case "$filename" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx)
    exit 0 ;;
  *.json|*.md|*.css|*.scss|*.mjs|*.cjs|*.js)
    exit 0 ;;
  CLAUDE.md)
    exit 0 ;;
esac

# Only check .ts and .tsx files
case "$extension" in
  ts|tsx) ;;
  *)
    exit 0 ;;
esac

# Skip files not under a src/ directory
if ! echo "$file_path" | grep -q '/src/'; then
  exit 0
fi

# Derive possible test file paths
dir=$(dirname "$file_path")
basename_no_ext="${filename%.*}"

# Check for test files in same dir, __tests__ subdir, or __tests__ sibling
test_found=false
for test_suffix in ".test.ts" ".test.tsx" ".spec.ts" ".spec.tsx"; do
  # Same directory
  if [ -f "${dir}/${basename_no_ext}${test_suffix}" ]; then
    test_found=true
    test_file="${dir}/${basename_no_ext}${test_suffix}"
    break
  fi
  # __tests__ subdirectory
  if [ -f "${dir}/__tests__/${basename_no_ext}${test_suffix}" ]; then
    test_found=true
    test_file="${dir}/__tests__/${basename_no_ext}${test_suffix}"
    break
  fi
  # Parent's __tests__ directory
  parent_dir=$(dirname "$dir")
  if [ -f "${parent_dir}/__tests__/${basename_no_ext}${test_suffix}" ]; then
    test_found=true
    test_file="${parent_dir}/__tests__/${basename_no_ext}${test_suffix}"
    break
  fi
done

if [ "$test_found" = false ]; then
  # Notify admin dashboard asynchronously (fire and forget)
  curl -sf \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Hook-Secret: ${HOOK_SECRET}" \
    -d "{\"event\":\"tdd.missing-test\",\"severity\":\"warning\",\"source\":\"${HOOK_AGENT}\",\"agent_id\":\"${HOOK_AGENT}\",\"title\":\"TDD: no test for ${filename}\",\"details\":{\"file\":\"${file_path}\",\"expected\":\"${basename_no_ext}.test.${extension}\"}}" \
    "${HOOK_ADMIN_URL}/api/hooks/notify" \
    --max-time 3 \
    > /dev/null 2>&1 &

  # No test file exists — warn and suggest creating one
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "TDD Advisory: No test file found for ${filename}. Consider writing tests first (RED phase) before implementation. Expected: ${basename_no_ext}.test.${extension} or ${basename_no_ext}.spec.${extension}"
  }
}
EOF
  exit 0
fi

# Test file exists — allow with a gentle reminder
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "TDD: Test file found at $(basename "$test_file"). Remember to run tests after changes."
  }
}
EOF
exit 0
