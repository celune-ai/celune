#!/bin/bash

# Claude Code PostToolUse hook — Slack message translator (template)
#
# This hook intercepts outgoing Slack messages and applies personality-aware
# translation before sending. It ensures agent messages match the workspace
# owner's communication style and tone preferences.
#
# Setup:
# 1. Configure SLACK_BOT_TOKEN in your .env.local
# 2. Set HOOK_AGENT to the sending agent's ID
# 3. Personality settings are read from the agent's config
#
# Hook type: PostToolUse (fires after Slack MCP tool calls)

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

# Extract tool name
tool_name=$(echo "$input" | jq -r '.tool_name // empty')

# Only intercept Slack send operations
case "$tool_name" in
  mcp__slack__send_message|mcp__slack__send_message_draft|mcp__slack__schedule_message)
    ;;
  *)
    exit 0
    ;;
esac

# TODO: Implement personality-aware message translation
# 1. Read agent personality config from Supabase or local config
# 2. Apply tone/style transformation to the message content
# 3. Log the translation to the admin dashboard for audit
# 4. Optionally require approval for messages above a certain formality threshold

# For now, allow all Slack messages through without modification
exit 0
