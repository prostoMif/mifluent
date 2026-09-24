#!/bin/sh
# Restore the database from one encrypted backup.
#
#   scripts/restore.sh mifluent-20260924T030000Z.sql.gz.enc
#
# Run from the directory with docker-compose.yml, on the server. It stops the
# web and worker containers, replaces the database contents with the backup,
# runs migrations (a backup may predate the newest ones) and starts them again.
#
# BACKUP_PASSPHRASE is read from .env; enter it by hand if it is not there.

set -eu

file="${1:?usage: scripts/restore.sh <backup file name in the backups volume>}"

echo "This replaces everything in the database with ${file}."
printf "Type the file name again to continue: "
read -r confirm
[ "${confirm}" = "${file}" ] || { echo "Stopped."; exit 1; }

docker compose stop web worker

docker compose run --rm --no-deps -T backup sh -eu -c '
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "/backups/$1" \
    | gunzip \
    | { echo "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;"; cat; } \
    | psql --set ON_ERROR_STOP=1 --quiet
' restore "${file}"

docker compose run --rm migrate
docker compose start web worker
echo "Restored from ${file}."
