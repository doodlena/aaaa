#!/usr/bin/env bash
# Restore an encrypted database backup made by .github/workflows/backup.yml. See docs/deployment/BACKUPS.md.
#
#   scripts/restore-backup.sh <backup-file.dump.gpg> <target-database-url>
#
# The target database is emptied and rebuilt from the backup in a single transaction, so a failed restore changes
# nothing. Stop the API service before running this and start it again afterwards. You are asked for the backup passphrase and
# to confirm the target. Needs gpg and Docker (pg_restore runs in the postgres image, matching the server version).
set -euo pipefail

file="${1:-}"
target="${2:-}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
if [ -z "$file" ] || [ -z "$target" ] || [ ! -f "$file" ]; then
  echo "usage: $0 <backup-file.dump.gpg> <target-database-url>" >&2
  exit 2
fi
case "$target" in postgres://*|postgresql://*) ;; *) echo "The target must be a postgres:// or postgresql:// URL." >&2; exit 2 ;; esac

# Show where this is going without printing the password.
safe=$(printf '%s' "$target" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#')
dbname=$(printf '%s' "$target" | sed -E 's#^[^/]*//[^/]*/([^?]*).*#\1#')
echo "Backup file : $file"
echo "Restore into: $safe"
echo
echo "This DELETES everything currently in that database and replaces it with the backup."
if [ "${RESTORE_CONFIRM:-}" != "$dbname" ]; then
  read -r -p "Type the database name ($dbname) to continue: " answer
  [ "$answer" = "$dbname" ] || { echo "Not confirmed. Nothing was changed."; exit 1; }
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --output "$work/lantern.dump" --decrypt "$file" 3<<<"$BACKUP_PASSPHRASE"
else
  gpg --quiet --output "$work/lantern.dump" --decrypt "$file"
fi

run_pg() { docker run --rm -i ${DOCKER_NETWORK:+--network "$DOCKER_NETWORK"} -e PGSSLMODE="${PGSSLMODE:-prefer}" -e TARGET="$target" "$PG_IMAGE" "$@"; }

# Fail before touching the target if the file is not a readable dump.
run_pg pg_restore --list < "$work/lantern.dump" > /dev/null

# Empty the target and load the backup in ONE transaction: if anything fails, the database is left exactly as it was.
# Emptying removes every extension and schema this role may drop (ones it may not, e.g. platform-owned, are skipped).
echo "Restoring (all-or-nothing)…"
run_pg sh -c '
  {
    cat <<"SQL"
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT extname FROM pg_extension WHERE extname <> $q$plpgsql$q$ LOOP
    BEGIN EXECUTE format($q$DROP EXTENSION IF EXISTS %I CASCADE$q$, r.extname); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname !~ $q$^pg_$q$ AND nspname <> $q$information_schema$q$ LOOP
    BEGIN EXECUTE format($q$DROP SCHEMA IF EXISTS %I CASCADE$q$, r.nspname); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
CREATE SCHEMA IF NOT EXISTS public;
SQL
    pg_restore --no-owner --no-acl -f -
  } | psql "$TARGET" -v ON_ERROR_STOP=1 --single-transaction -q -o /dev/null
' < "$work/lantern.dump"
echo "Done. Accounts in the restored database: $(run_pg sh -c 'psql "$TARGET" -tAc "SELECT count(*) FROM users"')"
echo "Start the API service again. It needs the same FOODACCESS_SECRET_KEY as before, or saved preferences stay unreadable."
