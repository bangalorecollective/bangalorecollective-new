#!/bin/bash
# Creates the master admin, or changes its password. Run on the VPS:
#
#   ./set-admin-password.sh admin@example.com          (asks for the password)
#   printf '%s' "$PASSWORD" | ./set-admin-password.sh admin@example.com
#
# Only a bcrypt hash is stored. Existing admin sessions are signed out.
set -euo pipefail
set -a; . /data/bangalorecollective/ops.env; set +a
email=${1:?usage: $0 email}

if [ -t 0 ]; then
  read -rsp "New password for $email: " password; echo
  read -rsp "Again: " again; echo
  [ "$password" = "$again" ] || { echo "Passwords do not match." >&2; exit 1; }
else
  password=$(cat)
fi
[ ${#password} -ge 12 ] || { echo "Use at least 12 characters." >&2; exit 1; }

docker exec -i "$DB_CONTAINER" psql -U postgres -d bangalorecollective -v ON_ERROR_STOP=1 -q \
  -v email="$email" -v password="$password" <<'SQL'
insert into app.admins (email, password_hash)
values (lower(:'email'), extensions.crypt(:'password', extensions.gen_salt('bf', 10)))
on conflict (email) do update set password_hash = excluded.password_hash;
delete from app.sessions where kind = 'admin' and admin_role = 'master-admin';
SQL
echo "Master admin $email is set."
