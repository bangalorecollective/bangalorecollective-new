#!/bin/bash
# Loads a Supabase backup into the VPS database. Run on the VPS from the folder holding ./import.
#
# Container names and AUTHENTICATOR_PASSWORD come from /data/bangalorecollective/ops.env.
# Expects in ./import (copied over SSH, never committed):
#   full.dump          pg_dump -Fc of the Supabase database
#   roles.sql          pg_dumpall --roles-only --no-role-passwords
#   counts-before.tsv  live row counts taken when the dump was made
#
# Only ever restores into a database that has no tables in public yet,
# so it can never overwrite data that is already there.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . /data/bangalorecollective/ops.env; set +a

PSQL=(docker exec -i "$DB_CONTAINER" psql -U postgres -d bangalorecollective -v ON_ERROR_STOP=1 -q)

existing=$("${PSQL[@]}" -At -c "select count(*) from pg_tables where schemaname = 'public'")
if [ "$existing" != "0" ]; then
  echo "public already has $existing tables; refusing to restore over it." >&2
  exit 1
fi

echo "--roles"
docker exec -i "$DB_CONTAINER" psql -U postgres -d bangalorecollective -q < import/roles.sql > import/roles.log 2>&1 || true
echo "role statements refused (expected for Supabase-only roles): $(grep -c ERROR import/roles.log || true)"

echo "--restore"
docker exec -i "$DB_CONTAINER" pg_restore -U postgres -d bangalorecollective < import/full.dump > import/restore.log 2>&1 || true
echo "restore errors: $(grep -c 'pg_restore: error' import/restore.log || true)"
if grep -E 'ERROR:' import/restore.log | grep -vqE 'vault|supabase_vault'; then
  echo "unexpected restore errors:" >&2
  grep -E 'ERROR:' import/restore.log | grep -vE 'vault|supabase_vault' >&2
  exit 1
fi

echo "--login role for PostgREST"
"${PSQL[@]}" -v pw="$AUTHENTICATOR_PASSWORD" <<'SQL'
alter role authenticator with login noinherit password :'pw';
-- Supabase preloads its pg-safeupdate add-on for this role; plain Postgres does not have it and
-- refuses the login. The same guard (no UPDATE/DELETE without a filter) is enforced in the app's
-- REST proxy instead.
alter role authenticator reset session_preload_libraries;
grant anon, authenticated to authenticator;
SQL

echo "--compare row counts with the live database at backup time"
"${PSQL[@]}" -At -F $'\t' > import/counts-restored.tsv <<'SQL'
select n.nspname, c.relname,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth', 'storage')
order by 1, 2;
SQL
if diff <(sort import/counts-before.tsv) <(sort import/counts-restored.tsv) > /dev/null; then
  echo "all $(wc -l < import/counts-restored.tsv) tables match"
else
  echo "row counts differ:" >&2
  diff <(sort import/counts-before.tsv) <(sort import/counts-restored.tsv) >&2
  exit 1
fi
