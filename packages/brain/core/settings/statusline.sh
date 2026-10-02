#!/bin/bash
# Celune Brain — CLI Statusline
# Shows workspace name and active project in your shell prompt.
#
# Usage: Source this file in your .bashrc or .zshrc:
#   source {{HOME}}/.celune/brain/settings/statusline.sh
#
# Then add $(celune_statusline) to your PS1/PROMPT:
#   export PS1="$(celune_statusline) \$ "

STATE_DIR="${CELUNE_STATE_DIR:-$HOME/.claude/state}"

celune_statusline() {
  local workspace_name=""
  local project_name=""
  local branch=""

  # Read active workspace
  if [ -f "$STATE_DIR/active-workspace.json" ]; then
    workspace_name=$(python3 -c "
import json, sys
try:
    data = json.load(open('$STATE_DIR/active-workspace.json'))
    print(data.get('workspace_name') or '')
except: pass
" 2>/dev/null)
  fi

  # Read active project
  if [ -f "$STATE_DIR/active-project.json" ]; then
    project_name=$(python3 -c "
import json, sys
try:
    data = json.load(open('$STATE_DIR/active-project.json'))
    print(data.get('project_name') or '')
except: pass
" 2>/dev/null)
  fi

  # Read active branch
  if [ -f "$STATE_DIR/active-branch.json" ]; then
    branch=$(python3 -c "
import json, sys
try:
    data = json.load(open('$STATE_DIR/active-branch.json'))
    print(data.get('branch') or '')
except: pass
" 2>/dev/null)
  fi

  # Fall back to git branch if no state file
  if [ -z "$branch" ]; then
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  fi

  # Build statusline
  local parts=()
  if [ -n "$workspace_name" ]; then
    parts+=("[${workspace_name}]")
  fi
  if [ -n "$project_name" ]; then
    parts+=("${project_name}")
  fi
  if [ -n "$branch" ]; then
    parts+=("(${branch})")
  fi

  if [ ${#parts[@]} -gt 0 ]; then
    echo "${parts[*]}"
  fi
}
