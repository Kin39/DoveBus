#!/bin/sh
# Daily backup of the pageview counter, run as `goatcounter` by
# goatcounter-backup.service (DEPLOY.md §8).
#
# It is the only data on the API machine that cannot be rebuilt from somewhere
# else, so a backup that is not checked is not trusted: each copy must pass
# SQLite's integrity check and still contain the site before it replaces
# anything. A failed run leaves the previous copies exactly as they were.
#
# SQLite's own `.backup` rather than `cp`: the database runs in WAL mode, and
# copying the main file without the -wal beside it copies a database missing
# its most recent hours.
#
# The healthchecks ping is optional (HC_COUNTER_BACKUP_URL, from
# /etc/dovebus/notify.env), and a ping that fails never fails the backup.

set -eu

DB="${GOATCOUNTER_DB:-/var/lib/goatcounter/db.sqlite3}"
DIR="${GOATCOUNTER_BACKUP_DIR:-/var/lib/goatcounter/backups}"
KEEP="${GOATCOUNTER_BACKUP_KEEP:-14}"
PING="${HC_COUNTER_BACKUP_URL:-}"

ping_hc() {
  [ -n "$PING" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$PING$1" || echo "warning: healthchecks ping failed" >&2
}

work=""
cleanup() {
  status=$?
  [ -n "$work" ] && rm -f "$work" "$work.gz"
  [ "$status" -eq 0 ] || ping_hc /fail
}
trap cleanup EXIT

mkdir -p "$DIR"
cd "$DIR"
work="$(mktemp "$DIR/.incoming.XXXXXX")"

sqlite3 "$DB" ".backup '$work'"

integrity="$(sqlite3 "$work" 'PRAGMA integrity_check;')"
if [ "$integrity" != "ok" ]; then
  echo "backup failed the integrity check: $integrity" >&2
  exit 1
fi

sites="$(sqlite3 "$work" 'SELECT count(*) FROM sites;')"
if [ "$sites" -lt 1 ]; then
  echo "backup has no site in it — refusing to keep it" >&2
  exit 1
fi

gzip -9 "$work"
name="$(date -u +%Y%m%d).sqlite3.gz"
mv "$work.gz" "$DIR/$name"
work=""
ln -sfn "$name" "$DIR/latest.sqlite3.gz"

# Newest first; everything after the first $KEEP goes.
find "$DIR" -maxdepth 1 -name '[0-9]*.sqlite3.gz' | sort -r | tail -n +"$((KEEP + 1))" |
  while read -r old; do rm -f "$old"; done

echo "backup ok: $DIR/$name ($(wc -c <"$DIR/$name") bytes, $sites site)"
ping_hc ""
