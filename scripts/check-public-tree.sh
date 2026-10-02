#!/usr/bin/env bash
# check-public-tree.sh: fail if founder-specific content is in the public tree.
#
# Runs against a built public tree (PUBLISHING.md step 1), or builds one from
# HEAD into a temp dir when no directory is given. Templates and code in the
# public repo must not name the founder, the founder's personal company, vault
# layout, home paths, or chat IDs.
#
# Suppression: add  ref-ok  to a line that is intentional.
#
# Usage:
#   bash scripts/check-public-tree.sh               # build from HEAD and scan
#   bash scripts/check-public-tree.sh <public-dir>  # scan an existing tree

set -euo pipefail

PATTERNS='\b(Eric|ERIC)\b|[Ss]mejkal|MyBrain|rickbot|U8T4DHYCT|[Bb]enefind|GitHub/second-brain|-Users-[a-z]+-'

# Intentional hits: the CLA allowlist names a maintainer account, the internal
# reference guard lists the patterns it blocks, migrations keep their history,
# product emails carry the founder's sign-off, and PUBLISHING.md shows the checks.
ALLOW_PATHS='^(\.github/workflows/cla\.yml|scripts/check-internal-refs\.sh|scripts/check-public-tree\.sh|PUBLISHING\.md|apps/platform/email-templates/|packages/db/schema/migrations/)'
ALLOW_LINES='Eric (&|&amp;) the Celune Team'

if [ -n "${1:-}" ]; then
  DIR=$1
else
  DIR=$(mktemp -d)
  trap 'rm -rf "$DIR"' EXIT
  ROOT=$(git rev-parse --show-toplevel)
  EXCLUDES=()
  # The public repository ships without the exclude list; its HEAD is already the public tree.
  if [ -f "$ROOT/scripts/public-tree-exclude.txt" ]; then
    while IFS= read -r line; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      EXCLUDES+=(":(exclude,top)$line")
    done < "$ROOT/scripts/public-tree-exclude.txt"
  fi
  git -C "$ROOT" archive HEAD -- . ${EXCLUDES[@]+"${EXCLUDES[@]}"} | tar -x -C "$DIR"
fi

HITS=$(cd "$DIR" && grep -rnIE "$PATTERNS" . --exclude-dir=node_modules --exclude=pnpm-lock.yaml \
  | sed 's|^\./||' | grep -vE "$ALLOW_PATHS" | grep -vE "$ALLOW_LINES" | grep -v 'ref-ok' || true)

if [ -n "$HITS" ]; then
  echo "Founder-specific content found in the public tree:"
  echo "$HITS" | cut -c1-200
  echo
  echo "Genericize it, add the path to scripts/public-tree-exclude.txt, or mark an intentional line with ref-ok."
  exit 1
fi
echo "Public tree check passed."
