#!/usr/bin/env bash
# Open-core boundary check: the open packages and the platform app must not name
# Celune's domains or the API key prefix. Those live in the config modules listed below.
#
# Also enforced:
#   - font files (.woff, .woff2, .otf, .ttf) are not committed outside ee/; open fonts come from npm;
#   - the formerly licensed brand fonts are gone from the whole repo, ee/ included,
#     by file name and by reference;
#   - @celuneai/ee-* is imported only where the edition switch lives.
#
# Symlinks are followed, so a link cannot hide a file from the scan.
#
# Usage: bash scripts/check-open-core.sh
# Exit 1 on any violation.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SCAN_PATHS=(packages apps/platform/src apps/platform/public apps/platform/next.config.ts)
SKIP_DIRS=(-name node_modules -o -name .next -o -name .turbo -o -name dist -o -name build -o -name coverage -o -name storybook-static)
CODE_EXT='\.(ts|tsx|css|js|mjs|cjs)$'
TEXT_EXT='\.(json|md|sql|sh)$'

CONFIG_MODULES=(
  'packages/core/src/config.ts'
  'packages/cli/src/defaults.ts'
  'apps/platform/src/lib/host-config.ts'
)

# Files allowed to name Celune's domains or key prefix, with the reason for each.
ALLOWED_FILES=(
  # npm metadata for Celune's published CLI
  'packages/cli/package.json'
  # documents the default key prefix and the project docs site
  'apps/platform/public/openapi.json'
  # historical migration comment that documents the key prefix
  'packages/db/schema/migrations/20260306_api_keys.sql'
  # Celune's own marketing and workflow skills, which ship in the default brain and link Celune's sites
  'packages/brain/core/skills/afk-blogging/CLAUDE.md'
  'packages/brain/core/skills/afk-blogging/refs/full-reference.md'
  'packages/brain/core/skills/email-template/CLAUDE.md'
  'packages/brain/core/skills/git-push/SKILL.md'
)

# Where the edition switch lives; the only files that may import @celuneai/ee-*.
EE_IMPORT_SITES=(
  'apps/platform/src/lib/gate.ts'
)

# One extended regex per rule; the prefix rule targets key literals and templates, not Slack action ids.
RULES=(
  'celune\.ai'
  "celune_(live|test)_|Bearer celune_|startsWith\(['\"\`]celune_|['\"\`]celune_['\"\`]|\`celune_\\\$\\{"
)

not_test() { grep -v '__tests__' | grep -v '\.test\.' || true; }
without() { grep -v -x -F -f <(printf '%s\n' "$@") || true; }

# find -L behaves the same on GNU and BSD; grep -R does not follow symlinks on macOS
ALL_FILES=$(find -L "${SCAN_PATHS[@]}" \( "${SKIP_DIRS[@]}" \) -prune -o -type f -print 2>/dev/null | not_test)
FILES=$(echo "$ALL_FILES" | grep -E "$CODE_EXT|$TEXT_EXT" || true)
CHECKED=$(echo "$FILES" | without "${CONFIG_MODULES[@]}" "${ALLOWED_FILES[@]}")

VIOLATIONS=""
for rule in "${RULES[@]}"; do
  hits=$(echo "$CHECKED" | xargs grep -nHE "$rule" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    VIOLATIONS+="$hits"$'\n'
  fi
done

CODE_FILES=$(echo "$ALL_FILES" | grep -E "$CODE_EXT" || true)
ee_hits=$(echo "$CODE_FILES" | without "${EE_IMPORT_SITES[@]}" | xargs grep -nHE '@celuneai/ee-' 2>/dev/null || true)
if [ -n "$ee_hits" ]; then
  VIOLATIONS+="$ee_hits"$'\n'
fi

REPO_SKIP=(-name node_modules -o -name .next -o -name .git -o -name .turbo -o -name dist -o -name coverage -o -name storybook-static)
# Paths in scripts/public-tree-exclude.txt never reach the public tree
REPO_SKIP+=(-o -path ./apps/admin -o -path ./.claude -o -path ./memory -o -path ./.scratch -o -path ./project-plans -o -path ./docs/research -o -path ./docs/security-policies)

font_hits=$(find -L . \( "${REPO_SKIP[@]}" -o -path ./ee \) -prune -o -type f \
  \( -iname '*.woff' -o -iname '*.woff2' -o -iname '*.otf' -o -iname '*.ttf' \) -print 2>/dev/null)
if [ -n "$font_hits" ]; then
  VIOLATIONS+="font files outside ee/:"$'\n'"$font_hits"$'\n'
fi

# The formerly licensed brand font names, in any spelling and case (see the regex)
BRAND_FONT='(s(ö|Ö|oe?)hne|circular[ _-]?std)'
brand_files=$(find -L . \( "${REPO_SKIP[@]}" \) -prune -o -type f -print 2>/dev/null | grep -iE "/[^/]*${BRAND_FONT}[^/]*$" || true)
brand_refs=$(find -L . \( "${REPO_SKIP[@]}" \) -prune -o -type f -print 2>/dev/null \
  | xargs grep -IlniE "$BRAND_FONT" 2>/dev/null | grep -v -x './scripts/check-open-core.sh' || true)
if [ -n "$brand_files$brand_refs" ]; then
  VIOLATIONS+="licensed brand font files or references:"$'\n'"$brand_files"$'\n'"$brand_refs"$'\n'
fi

if [ -n "$VIOLATIONS" ]; then
  echo "ERROR: open-core boundary violations (brand, host, key prefix, font, or ee import):"
  echo ""
  echo "$VIOLATIONS"
  echo "Read these values from @celuneai/core/config (packages) or @/lib/branding and @/lib/host-config (platform)."
  echo "Celune Cloud code belongs under ee/, imported only from the edition switch. Fonts come from npm packages."
  exit 1
fi

echo "Open-core boundary check passed."
