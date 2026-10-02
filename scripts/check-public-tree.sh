#!/usr/bin/env bash
# check-public-tree.sh: fail if founder-specific content is in the public tree.
#
# Scans the committed tree at HEAD, or a directory given as the first argument.
# Templates and code in this repository must not name the founder, the
# founder's personal company, vault layout, home paths, or chat IDs.
#
# Suppression: add  ref-ok  to a line that is intentional.
#
# Usage:
#   bash scripts/check-public-tree.sh         # scan the committed tree at HEAD
#   bash scripts/check-public-tree.sh <dir>   # scan a directory

set -euo pipefail

PATTERNS='\b(Eric|ERIC)\b|[Ss]mejkal|MyBrain|rickbot|U8T4DHYCT|[Bb]enefind|GitHub/second-brain|-Users-[a-z]+-'

# Intentional hits: the CLA allowlist names a maintainer account, the internal
# reference guard lists the patterns it blocks, migrations keep their history,
# and product emails carry the founder's sign-off.
ALLOW_PATHS='^(\.github/workflows/cla\.yml|scripts/check-internal-refs\.sh|scripts/check-public-tree\.sh|apps/platform/email-templates/|packages/db/schema/migrations/)'
ALLOW_LINES='Eric (&|&amp;) the Celune Team'

if [ -n "${1:-}" ]; then
  DIR=$1
else
  DIR=$(mktemp -d)
  trap 'rm -rf "$DIR"' EXIT
  ROOT=$(git rev-parse --show-toplevel)
  git -C "$ROOT" archive HEAD | tar -x -C "$DIR"
fi

HITS=$(cd "$DIR" && grep -rnIE "$PATTERNS" . --exclude-dir=node_modules --exclude=pnpm-lock.yaml \
  | sed 's|^\./||' | grep -vE "$ALLOW_PATHS" | grep -vE "$ALLOW_LINES" | grep -v 'ref-ok' || true)

if [ -n "$HITS" ]; then
  echo "Founder-specific content found in the public tree:"
  echo "$HITS" | cut -c1-200
  echo
  echo "Genericize it, or mark an intentional line with ref-ok."
  exit 1
fi
echo "Public tree check passed."
