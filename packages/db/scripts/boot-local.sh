#!/usr/bin/env bash
# Boot an empty Supabase/Postgres database from this repo's schema files alone.
#
# Usage:
#   supabase start                                   # or any empty Postgres with the auth schema
#   packages/db/scripts/boot-local.sh                # defaults to the local supabase DB URL
#   DATABASE_URL=postgresql://... packages/db/scripts/boot-local.sh
#
# A database with no public tables gets schema/baseline/0001_baseline.sql in one
# transaction. The baseline records every migration it covers in
# public._migrations, so only migration files newer than the baseline run after it.
# Set BOOT_BASELINE=0 to boot an empty database from the incremental files instead.
#
# Any other database gets schema/supabase-schema.sql (when public._migrations is
# missing), then every unrecorded migration in bytewise order (the same order
# scripts/migrate.mjs uses). Either way the script ends by asserting that every
# table declared under schema/ exists.
#
# Legacy migrations (002-029) were written for the SQL editor and some of them
# recreate objects the base schema already defines, so "already exists" errors
# are tolerated (same rule as migrate.mjs --continue-on-error). Any other SQL
# error fails the boot.
set -uo pipefail

SCHEMA_DIR="$(cd "$(dirname "$0")/../schema" && pwd)"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PSQL="${PSQL:-psql}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

tolerated=0
failed=0
last_ok=1
apply() {
  local out
  out=$("$PSQL" "$DATABASE_URL" -X -q -f "$1" 2>&1)
  local hard
  hard=$(echo "$out" | grep -E '^psql:.*(ERROR|FATAL)' | grep -vE 'already exists|already member of publication' || true)
  if [ -n "$hard" ]; then
    echo "$hard"
    echo "== FAILED on $1"
    # BOOT_KEEP_GOING=1 surveys every failing file in one pass instead of stopping at the first.
    if [ "${BOOT_KEEP_GOING:-0}" != "1" ]; then
      exit 1
    fi
    failed=$((failed + 1))
    last_ok=0
  else
    last_ok=1
  fi
  local soft
  soft=$(echo "$out" | grep -cE 'ERROR:.*already exists' || true)
  tolerated=$((tolerated + soft))
}

file_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -c1-16
  else
    shasum -a 256 "$1" | cut -c1-16
  fi
}

# Files already recorded in public._migrations (by this script or migrate.mjs)
# are skipped, so a re-run applies only new migrations.
applied=""
has_tracking=$("$PSQL" "$DATABASE_URL" -X -tA -c "select to_regclass('public._migrations') is not null" 2>/dev/null || echo "f")
public_tables=$("$PSQL" "$DATABASE_URL" -X -tA -c "select count(*) from pg_tables where schemaname = 'public'" 2>/dev/null || echo "-1")
BASELINE="$SCHEMA_DIR/baseline/0001_baseline.sql"
if [ "$has_tracking" != "t" ] && [ "$public_tables" = "0" ] && [ "${BOOT_BASELINE:-1}" != "0" ] && [ -f "$BASELINE" ]; then
  echo "== empty database; applying baseline/0001_baseline.sql"
  if ! "$PSQL" "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$BASELINE" >/dev/null; then
    echo "== FAILED on baseline/0001_baseline.sql (rolled back)"
    exit 1
  fi
  has_tracking="t"
fi
if [ "$has_tracking" = "t" ]; then
  applied=$("$PSQL" "$DATABASE_URL" -X -tA -c "select filename from public._migrations")
  echo "== schema already booted; skipping supabase-schema.sql"
else
  echo "== applying supabase-schema.sql"
  apply "$SCHEMA_DIR/supabase-schema.sql"
fi

count=0
skipped=0
for f in $(cd "$SCHEMA_DIR/migrations" && ls ./*.sql | LC_ALL=C sort); do
  f="${f#./}"
  if [ -n "$applied" ] && grep -qxF "$f" <<<"$applied"; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "== applying $f"
  apply "$SCHEMA_DIR/migrations/$f"
  # Only files that applied cleanly are recorded, so a failed file runs again next time.
  if [ "$last_ok" = "1" ]; then
    "$PSQL" "$DATABASE_URL" -X -q -c \
      "insert into public._migrations (filename, hash, applied_by) values ('$f', '$(file_hash "$SCHEMA_DIR/migrations/$f")', 'boot-local') on conflict (filename) do nothing" \
      >/dev/null 2>&1 || true
  fi
  count=$((count + 1))
done
echo "== applied $count migrations, skipped $skipped already recorded ($tolerated 'already exists' errors tolerated)"
if [ "$failed" -gt 0 ]; then
  echo "== $failed migration files failed"
  exit 1
fi

# Tables declared anywhere under schema/, minus tables a later migration drops.
declared=$(grep -rhoiE 'create table( if not exists)? +(public\.)?"?[a-z_]+"?' "$SCHEMA_DIR" \
  | sed -E 's/.*[ .]"?([a-zA-Z_]+)"?$/\1/' | tr '[:upper:]' '[:lower:]' | sort -u)
dropped=$(grep -rhoiE 'drop table( if exists)? +(public\.)?"?[a-z_]+"?' "$SCHEMA_DIR" \
  | sed -E 's/.*[ .]"?([a-zA-Z_]+)"?$/\1/' | tr '[:upper:]' '[:lower:]' | sort -u)
expected=$(comm -23 <(echo "$declared") <(echo "$dropped"))

present=$("$PSQL" "$DATABASE_URL" -X -tA -c \
  "select tablename from pg_tables where schemaname = 'public' order by 1")

missing=$(comm -23 <(echo "$expected") <(echo "$present" | sort -u))
if [ -n "$missing" ]; then
  echo "== MISSING tables:" $missing
  exit 1
fi
echo "== all $(echo "$expected" | wc -l | tr -d ' ') declared tables present ($(echo "$present" | wc -l | tr -d ' ') public tables total)"
