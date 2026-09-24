#!/bin/sh
# Daily encrypted database backup, kept on the `backups` volume.
#
# Runs inside the backup container. Once a day at 03:00 UTC: pg_dump, gzip,
# then AES-256 with the passphrase from BACKUP_PASSPHRASE. Keeps the newest
# BACKUPS_KEPT files and deletes older ones.
#
# The passphrase must not be stored anywhere these files are copied to — a
# backup that travels with its key is not encrypted. See docs/deploy.md.

set -eu

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
KEEP="${BACKUPS_KEPT:-7}"

dump() {
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="/backups/mifluent-${stamp}.sql.gz.enc"

  pg_dump --no-owner --no-privileges \
    | gzip -9 \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
    > "${target}.partial"
  mv "${target}.partial" "${target}"
  echo "backup written: ${target}"

  # Newest first; everything after the first $KEEP goes.
  ls -1t /backups/mifluent-*.sql.gz.enc 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f
}

# Arithmetic on the epoch rather than date parsing: busybox `date` in the
# Alpine image does not read every format GNU date does.
seconds_until_three() {
  into_day=$(( $(date -u +%s) % 86400 ))
  wait=$(( (3 * 3600 - into_day + 86400) % 86400 ))
  [ "${wait}" -eq 0 ] && wait=86400
  echo "${wait}"
}

if [ "${1:-}" = "--now" ]; then
  dump
  exit 0
fi

while true; do
  sleep "$(seconds_until_three)"
  dump
done
