#!/bin/sh
# Copies the counter's latest backup off the API machine, run on the owner's PC
# by a systemd user timer (DEPLOY.md §8).
#
# The VPS keeps two weeks of backups, which protects against a bad day and not
# against losing the machine. This is the copy that survives that. Pulling from
# the PC rather than pushing from the VPS keeps every credential where it
# already was: the PC's SSH key, no storage key on the server, no account.
#
# A copy is kept only when it decompresses, passes SQLite's integrity check, and
# is not older than the newest copy already here — a server restored from an old
# image would otherwise overwrite good history with stale data, quietly.
#
#   DOVEBUS_SSH_HOST       required, e.g. ubuntu@<the VPS>
#   DOVEBUS_BACKUP_DIR     default ~/dovebus-backups/goatcounter
#   HC_COUNTER_PULL_URL    optional healthchecks ping

set -eu

HOST="${DOVEBUS_SSH_HOST:?set DOVEBUS_SSH_HOST to the API machine, e.g. ubuntu@host}"
DEST="${DOVEBUS_BACKUP_DIR:-$HOME/dovebus-backups/goatcounter}"
KEEP="${DOVEBUS_BACKUP_KEEP:-60}"
PING="${HC_COUNTER_PULL_URL:-}"
REMOTE_DIR=/var/lib/goatcounter/backups

ping_hc() {
  [ -n "$PING" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "$PING$1" || echo "warning: healthchecks ping failed" >&2
}

work=""
cleanup() {
  status=$?
  [ -n "$work" ] && rm -f "$work" "$work.db" "$work.db-shm" "$work.db-wal"
  [ "$status" -eq 0 ] || ping_hc /fail
}
trap cleanup EXIT

mkdir -p "$DEST"

name="$(ssh -o BatchMode=yes "$HOST" "sudo readlink $REMOTE_DIR/latest.sqlite3.gz")"
case "$name" in
  [0-9]*.sqlite3.gz) ;;
  *) echo "unexpected backup name on the server: '$name'" >&2; exit 1 ;;
esac

if [ -f "$DEST/$name" ]; then
  echo "already have $name"
  ping_hc ""
  exit 0
fi

work="$(mktemp "$DEST/.incoming.XXXXXX")"
ssh -o BatchMode=yes "$HOST" "sudo cat $REMOTE_DIR/$name" >"$work"
gzip -t <"$work"
gzip -dc <"$work" >"$work.db"

# The newest hour with pageviews: the one number that only moves forward.
newest="$(python3 -I - "$work.db" <<'EOF'
import sqlite3, sys
# immutable: reading must not leave -shm/-wal files behind beside the copy.
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro&immutable=1", uri=True)
check = db.execute("PRAGMA integrity_check").fetchone()[0]
if check != "ok":
    sys.exit(f"integrity check failed: {check}")
if db.execute("SELECT count(*) FROM sites").fetchone()[0] < 1:
    sys.exit("no site in the backup")
print(db.execute("SELECT coalesce(max(hour), '') FROM hit_counts").fetchone()[0])
EOF
)"

previous="$(cat "$DEST/newest-hour" 2>/dev/null || true)"
if [ -n "$previous" ] && [ "$newest" \< "$previous" ]; then
  echo "backup $name ends at '$newest', older than the copy already kept ('$previous') — refusing it" >&2
  exit 1
fi

mv "$work" "$DEST/$name"
rm -f "$work.db" "$work.db-shm" "$work.db-wal"
work=""
printf '%s\n' "$newest" >"$DEST/newest-hour"

find "$DEST" -maxdepth 1 -name '[0-9]*.sqlite3.gz' | sort -r | tail -n +"$((KEEP + 1))" |
  while read -r old; do rm -f "$old"; done

echo "pulled $name (newest hour $newest)"
ping_hc ""
