#!/bin/sh
# Every five minutes: is the public API healthy? Run by api-health-ping.timer
# (DEPLOY.md, "Living with it").
#
# It asks the public address, not localhost, so DNS, TLS and Caddy are part of
# the answer. A healthy answer pings healthchecks (HC_API_HEALTH_URL). Anything
# else is *logged* there, not reported as a failure: the API says `degraded` for
# about a minute after every restart while the first trip-updates poll lands,
# and an explicit failure would page for that. Silence instead lets the check's
# grace period decide — the alert comes only when health has been missing for
# longer than any warm-up. If the whole machine is down, the pings stop and the
# same silence raises the alert.

set -u

URL="${DOVEBUS_HEALTHZ_URL:-https://api.dovebus.it/healthz}"
PING="${HC_API_HEALTH_URL:?set HC_API_HEALTH_URL (see /etc/dovebus/notify.env)}"

body="$(curl -fsS -m 20 "$URL" 2>&1)"

case "$body" in
  *'"status":"ok"'*)
    curl -fsS -m 10 --retry 3 -o /dev/null "$PING" || echo "warning: healthchecks ping failed" >&2
    exit 0
    ;;
esac

reason="$(printf '%s' "$body" | head -c 2000)"
echo "API not healthy: $(printf '%s' "$reason" | head -c 300)" >&2
curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "not healthy: $reason" "$PING/log" ||
  echo "warning: healthchecks log failed" >&2
exit 1
