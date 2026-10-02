#!/usr/bin/env bash
# Lint: detect hardcoded celune.ai URLs in source files.
# Allowed files: branding.ts, .env*, *.json, *.md, *.html, agentmail.ts
#
# Usage: bash scripts/check-hardcoded-urls.sh
# Returns exit 1 if violations found.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

VIOLATIONS=$(grep -rn 'https\?://[a-z.]*celune\.ai' \
  --include='*.ts' --include='*.tsx' --include='*.mjs' \
  --exclude-dir='node_modules' --exclude-dir='.next' --exclude-dir='.turbo' --exclude-dir='dist' \
  "$ROOT_DIR/apps" "$ROOT_DIR/packages" \
  | grep -v 'branding\.ts' \
  | grep -v 'agentmail\.ts' \
  | grep -v '\.env' \
  | grep -v '\.test\.' \
  | grep -v '__tests__' \
  | grep -v 'packages/cli/' \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: Found hardcoded celune.ai URLs. Use branding constants from @/lib/branding instead."
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Allowed exceptions: branding.ts, agentmail.ts, .env files, test files, JSON, HTML, MD"
  exit 1
fi

echo "No hardcoded celune.ai URLs found in source."
exit 0
