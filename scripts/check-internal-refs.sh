#!/usr/bin/env bash
# check-internal-refs.sh — Grep gate for stale internal/personal references.
#
# Scans staged (or all tracked) files for patterns that should not ship:
#   - the old personal domains (see PATTERNS)
#   - the retired .app and .dev domains (should be celune.ai)
#
# Suppression: add  # ref-ok  to a line to whitelist it.
#
# Usage:
#   bash scripts/check-internal-refs.sh          # scan staged files (pre-commit mode)
#   bash scripts/check-internal-refs.sh --all    # scan all tracked files (CI mode)

set -euo pipefail

RED='\033[31m'
YELLOW='\033[33m'
DIM='\033[90m'
BOLD='\033[1m'
RESET='\033[0m'

# Patterns to flag (extended grep)
PATTERNS=(
  'smejkal\.design'
  'smejkaldesign\.com'
  'celune\.app'
  'celune\.dev'
  'Mission Control'
)

# Directories / paths to skip (memory, docs, research, specs, changelogs, config)
SKIP_PATHS=(
  'memory/'
  'my-brain/'
  '.claude/'
  'docs/deployment-runbook'
  'CHANGELOG'
  '.env'
  'node_modules/'
  '.next/'
  'dist/'
  '.turbo/'
)

# Build combined grep pattern
COMBINED=""
for p in "${PATTERNS[@]}"; do
  if [ -z "$COMBINED" ]; then
    COMBINED="$p"
  else
    COMBINED="$COMBINED|$p"
  fi
done

# Get file list
if [ "${1:-}" = "--all" ]; then
  FILES=$(git ls-files)
else
  FILES=$(git diff --cached --name-only --diff-filter=ACMR)
fi

if [ -z "$FILES" ]; then
  exit 0
fi

FOUND=0

while IFS= read -r file; do
  # Skip binary / non-text
  [[ "$file" == *.png || "$file" == *.jpg || "$file" == *.gif || "$file" == *.ico ]] && continue
  [[ "$file" == *.woff || "$file" == *.woff2 || "$file" == *.ttf || "$file" == *.eot ]] && continue
  [[ "$file" == *.svg || "$file" == *.pdf || "$file" == *.lock ]] && continue
  [[ "$file" == *.sqlite* ]] && continue

  # Skip allowlisted paths
  SKIP=0
  for sp in "${SKIP_PATHS[@]}"; do
    if [[ "$file" == *"$sp"* ]]; then
      SKIP=1
      break
    fi
  done
  [ "$SKIP" -eq 1 ] && continue

  # Skip this script itself
  [[ "$file" == "scripts/check-internal-refs.sh" ]] && continue

  # Check if file exists
  [ -f "$file" ] || continue

  # Grep, excluding suppressed lines
  MATCHES=$(grep -nE "$COMBINED" "$file" 2>/dev/null | grep -v '# ref-ok' | grep -v '// ref-ok' || true)

  if [ -n "$MATCHES" ]; then
    if [ "$FOUND" -eq 0 ]; then
      echo ""
      echo -e "${RED}${BOLD}╔══ INTERNAL REFERENCE CHECK FAILED ═══════════════════════════╗${RESET}"
      echo -e "${RED}║  Stale internal references found in staged files.             ║${RESET}"
      echo -e "${RED}║  Replace with celune.ai equivalents before committing.        ║${RESET}"
      echo -e "${RED}╚════════════════════════════════════════════════════════════════╝${RESET}"
      echo ""
    fi
    FOUND=1
    while IFS= read -r match; do
      LINENO_NUM=$(echo "$match" | cut -d: -f1)
      LINE_CONTENT=$(echo "$match" | cut -d: -f2-)
      echo -e "  ${YELLOW}${file}:${LINENO_NUM}${RESET}  ${LINE_CONTENT}"
    done <<< "$MATCHES"
  fi
done <<< "$FILES"

if [ "$FOUND" -ne 0 ]; then
  echo ""
  echo -e "${DIM}  To suppress a line: append  # ref-ok  (or  // ref-ok  in TS/JS)${RESET}"
  echo -e "${DIM}  To bypass: git commit --no-verify${RESET}"
  echo ""
  exit 1
fi

exit 0
