#!/usr/bin/env bash
# setup-git-hooks.sh — Configure git to use the versioned .githooks/ directory.
#
# Run once after cloning:
#   bash scripts/setup-git-hooks.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.githooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "Error: .githooks/ directory not found at $HOOKS_DIR" >&2
  exit 1
fi

git config core.hooksPath .githooks
echo "Git hooks configured: using .githooks/"
echo "Active hooks:"
ls -1 "$HOOKS_DIR"
