# Deploying DoveBus

Two machines, one domain, three names.

```
dovebus.it        →  Netlify         static pages, built from client/
api.dovebus.it    →  a small VPS     Caddy (TLS) → Node on 127.0.0.1:3200 → SQLite
stats.dovebus.it  →  the same VPS    Caddy (TLS) → GoatCounter on 127.0.0.1:8081 → SQLite
```

The frontend is a bundle of files; the API is one always-on process holding a
1.2 GB timetable and two realtime pollers; the counter is a single static Go
binary with a SQLite file of its own. Nothing else is running: no database
server, no queue, no container runtime.

Measured, so you can size any machine against it: the API sits at **133 MB RSS**,
the daily rebuild peaks at **774 MB** and takes **~3 minutes** end to end, the
database is **1.19 GB** on disk and about **2.6 GB** while a refresh is staging
the next one. Two GB of RAM is the floor; 20 GB of disk is plenty.

Every command below is run as `root` unless it says otherwise.

---

## 0. Before you start

- **The domain.** `dovebus.it` must be registered and its DNS editable by you.
  The API needs `api.dovebus.it` pointing at the VPS **before** Caddy first runs,
  or the certificate request fails; `stats.dovebus.it` has to be there before the
  block in §8, for the same reason.
- **The VPS.** Ubuntu 24.04 LTS (or 26.04 — see the note in step 2), 2 GB RAM
  minimum, its IPv4 and IPv6 addresses to hand.
- **Your SSH public key**, ready to paste.

## 1. First login, and closing the door behind you

**The user is probably not `root`.** OVH's Ubuntu images have no root SSH login at
all: the account is `ubuntu`, its password arrives from the provider, and the
first login forces a password change — which `ssh-copy-id` cannot do, because it
has no terminal to type the new one into. So log in normally first, change the
password, and only then install the key.

```bash
ssh ubuntu@YOUR_SERVER_IP
```

```bash
ssh-copy-id ubuntu@YOUR_SERVER_IP
```

Everything below that says "as root" means after `sudo -i`.

If your provider does give you root and a password, replace it with your key now:

```bash
mkdir -p ~/.ssh && nano ~/.ssh/authorized_keys   # paste your public key, save
```

```bash
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

Then turn password logins off — **open a second terminal and confirm your key
works before you do this**, or a typo locks you out of your own machine:

```bash
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart ssh
```

The firewall, allowing only what is used. The API listens on loopback and is
never reachable from outside except through Caddy:

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Security updates without you:

```bash
apt update && apt install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
```

## 2. Node 22, and the tools a native module may need

```bash
apt install -y curl git build-essential python3
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
```

```bash
node --version   # must print v22 or newer
```

> **On Ubuntu 26.04**: everything here works the same. The one thing to watch is
> `better-sqlite3` — if `npm ci` compiles it from source instead of downloading a
> prebuilt binary, that is why it takes minutes instead of seconds. It still
> works; `build-essential` and `python3` above are what make it possible.

## 3. The application, as its own user

Running the API as `root` would be running a public-facing process with the keys
to the machine. It needs nothing but its own directory:

```bash
adduser --system --group --home /srv/dovebus dovebus
```

**The repository is private**, so the machine needs its own read-only access — a
deploy key, generated on the VPS and registered on the repo. Read-only is not a
formality: this server never pushes anything.

```bash
install -d -o dovebus -g dovebus -m 700 /srv/dovebus-keys && sudo -u dovebus ssh-keygen -q -t ed25519 -N "" -C "dovebus-deploy@vps" -f /srv/dovebus-keys/id_ed25519 && cat /srv/dovebus-keys/id_ed25519.pub
```

Register that public key on GitHub — *Settings → Deploy keys → Add deploy key*,
with **write access left unchecked** — or with the CLI:

```bash
gh api -X POST repos/OWNER/REPO/keys -f title="dovebus-vps (read-only)" -f key="PASTE_THE_PUBLIC_KEY" -F read_only=true
```

```bash
install -d -o dovebus -g dovebus -m 755 /srv/dovebus && sudo -u dovebus -H env GIT_SSH_COMMAND="ssh -i /srv/dovebus-keys/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git clone git@github.com:OWNER/REPO.git /srv/dovebus
```

```bash
sudo -u dovebus git -C /srv/dovebus config core.sshCommand "ssh -i /srv/dovebus-keys/id_ed25519 -o IdentitiesOnly=yes"
```

```bash
cd /srv/dovebus && sudo -u dovebus npm ci --omit=dev
```

`--omit=dev` is deliberate and it works: the server runs its TypeScript through
`tsx`, which is a runtime dependency. There is no build step and no compiled
output on the server.

## 4. The first timetable

This downloads ~138 MB and rebuilds the database. Three minutes, and the machine
will be busy for most of them:

```bash
cd /srv/dovebus && sudo -u dovebus npm run import
```

It ends with `database published` and the row counts. If it ends with anything
else, stop here — the API has nothing to serve.

## 5. The two units

The API. Note `DOVEBUS_TRUST_PROXY=1`: exactly one proxy (Caddy) sits in front,
so the API believes exactly one hop of `X-Forwarded-For` and no more — which is
what keeps the per-IP limits from being evadable with a forged header.

```bash
cat > /etc/systemd/system/dovebus-api.service <<'EOF'
[Unit]
Description=DoveBus API
After=network-online.target
Wants=network-online.target

[Service]
User=dovebus
Group=dovebus
WorkingDirectory=/srv/dovebus/server
ExecStart=/usr/bin/npm run serve
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=DOVEBUS_HOST=127.0.0.1
Environment=DOVEBUS_PORT=3200
Environment=DOVEBUS_TRUST_PROXY=1
Environment=DOVEBUS_CORS_ORIGIN=https://dovebus.it
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/srv/dovebus/data

[Install]
WantedBy=multi-user.target
EOF
```

The daily refresh. It is a safety net rather than the only defence — the API
watches its own match rate and refreshes itself when the operator republishes —
but it is the thing that eventually brings a new feed in after the watch has
given up on the current one:

```bash
cat > /etc/systemd/system/dovebus-refresh.service <<'EOF'
[Unit]
Description=DoveBus timetable refresh

[Service]
Type=oneshot
User=dovebus
Group=dovebus
WorkingDirectory=/srv/dovebus/server
ExecStart=/usr/bin/npm run refresh
EOF
```

```bash
cat > /etc/systemd/system/dovebus-refresh.timer <<'EOF'
[Unit]
Description=Refresh the DoveBus timetable daily

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
```

```bash
systemctl daemon-reload && systemctl enable --now dovebus-api dovebus-refresh.timer
```

```bash
curl -s localhost:3200/healthz | head -c 300
```

That must answer `"status":"ok"`. If it says `degraded`, read the `timetable`
block it returns — it tells you which of the two feeds it is unhappy about.

## 6. DNS, then Caddy

**DNS first.** At your registrar, for `dovebus.it`:

| Record | Name | Value |
|---|---|---|
| A | `api` | the VPS IPv4 |
| AAAA | `api` | the VPS IPv6 |
| A | `stats` | the VPS IPv4 |
| AAAA | `stats` | the VPS IPv6 |

Wait until this answers with your server's address:

```bash
dig +short api.dovebus.it && dig +short stats.dovebus.it
```

Only then install Caddy:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
```

```bash
apt update && apt install -y caddy
```

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
# No `log` directive anywhere in this file, and that is deliberate. Caddy writes
# no access log until it is asked to, and asking would write every request URL
# to disk — including the API search endpoints, whose query strings carry the
# line and the two comuni somebody searched for. The privacy page promises that
# "a successful search leaves no trace". This absence is what makes that true.

api.dovebus.it {
	reverse_proxy 127.0.0.1:3200

	# JSON only, on purpose. The live-trip endpoint is Server-Sent Events, and
	# compressing a stream means buffering it — which turns "the bus moved" into
	# "the bus moved, delivered later, in a batch".
	encode zstd gzip {
		match {
			header Content-Type application/json*
		}
	}
}

stats.dovebus.it {
	# GoatCounter listens on loopback only; this is the only way in. It reads the
	# scheme from X-Forwarded-Proto, which Caddy sets by default, and that is what
	# makes it mark its own admin cookie Secure. Those cookies belong to this host
	# and are never sent to dovebus.it — which is what keeps the "no cookies"
	# promise true for readers of the site itself.
	reverse_proxy 127.0.0.1:8081

	encode zstd gzip
}
EOF
```

The stats block will fail to get a certificate until §8 has installed the thing
it proxies to. If you are following this in order, come back and reload Caddy
after that section rather than debugging a 502 here.

```bash
systemctl reload caddy && curl -s https://api.dovebus.it/healthz | head -c 200
```

Caddy fetches the certificate on that first request. If it fails, `journalctl -u
caddy -n 50` will say whether it was DNS or the firewall.

## 7. Netlify

The build settings come from the committed `netlify.toml`; what Netlify cannot
know are the three deploy facts. Set them under **Site settings → Environment
variables**:

| Variable | Value |
|---|---|
| `SITE_URL` | `https://dovebus.it` |
| `VITE_API_BASE` | `https://api.dovebus.it` |
| `CONTACT_EMAIL` | the address you want in the footer and the privacy page |
| `VITE_STATS_BASE` | `https://stats.dovebus.it` — **omit it and the site counts nothing** |

**All four are baked into the build**, not read at runtime — `VITE_API_BASE`
ends up inside the JavaScript *and* inside the `connect-src` of the generated
`_headers`. Change either and you rebuild; the build refuses to publish a CSP
that names an API the bundle does not call.

`VITE_STATS_BASE` works the same way and fails the same way in both directions.
Unset, the counter is dropped from the bundle by the tree-shaker and no counter
origin appears in the CSP — a build that counts nothing, which is what every
build that is not this deploy should be. Set, the counter ships and the header
allows it. If those two ever disagree the build stops rather than publishing a
site that fires a request its own CSP blocks, or a header advertising a counter
that was optimised away.

Then point the apex domain at Netlify (their dashboard gives you the records)
and deploy.

## 8. The pageview counter

A GoatCounter of our own, on the same machine, reachable at `stats.dovebus.it`.
It exists to answer one question — is anybody using this — and it is configured
so that answering it costs a reader nothing that could identify them.

**Why not the hosted one, or anything else:** a single static Go binary with
SQLite fits beside a 1.2 GB timetable on a 4 GB machine, which Plausible CE
(Postgres *and* ClickHouse) and Matomo (2 GB for the app server alone, plus
MySQL) do not. Matomo also writes cookies and keeps the IP in the clear by
default. Self-hosted means no processor, no contract, no transfer out of the EU.

```bash
adduser --system --group --home /var/lib/goatcounter goatcounter
```

The binary. There is **no checksum file published** with the release, so the
digest below is one recorded here at install time: it cannot prove the first
download, but every upgrade after it can be checked against a value that was
written down rather than fetched alongside the thing it vouches for.

```bash
cd /tmp && curl -fsSL -o gc.gz https://github.com/arp242/goatcounter/releases/download/v2.7.0/goatcounter-v2.7.0-linux-amd64.gz && gzip -dc gc.gz > goatcounter && sha256sum goatcounter
```

    bb753bad7cdf9d75b8f1a5183a570dcdcc8705f2419ab40698f4c752796d6567  goatcounter

```bash
install -o root -g root -m 755 /tmp/goatcounter /usr/local/bin/goatcounter && rm -f /tmp/gc.gz /tmp/goatcounter && goatcounter version
```

```bash
install -d -o goatcounter -g goatcounter -m 750 /var/lib/goatcounter && sudo -u goatcounter goatcounter db migrate -db "sqlite+/var/lib/goatcounter/db.sqlite3" -createdb all
```

The `sqlite3` command-line tool is not on a stock Ubuntu image and is not needed
to *run* any of this — GoatCounter and the API both link their own SQLite. It is
needed to **back the counter up**, which is the one thing here nobody else holds
a copy of, so install it now rather than discovering it is missing on the day it
matters:

```bash
apt install -y sqlite3
```

The unit, on the same shape as `dovebus-api.service`. `-tls http` is not a
mistake: Caddy terminates TLS, and GoatCounter reads the scheme back out of the
`X-Forwarded-Proto` header Caddy sets — which is how it decides to mark its own
admin cookie `Secure`.

**`-domain stats.dovebus.it` must be exactly that.** It is what `cookieDomain()`
falls back to when it stamps the admin session cookie. Written as `dovebus.it`
or `.dovebus.it` it would produce a parent-domain cookie that *is* sent to the
site itself, and the privacy page's flattest promise would become false without
anything appearing to break.

```bash
cat > /etc/systemd/system/goatcounter.service <<'EOF'
[Unit]
Description=GoatCounter, the DoveBus pageview counter
After=network-online.target
Wants=network-online.target

[Service]
User=goatcounter
Group=goatcounter
WorkingDirectory=/var/lib/goatcounter
ExecStart=/usr/local/bin/goatcounter serve \
  -listen 127.0.0.1:8081 \
  -tls http \
  -db "sqlite+/var/lib/goatcounter/db.sqlite3" \
  -domain stats.dovebus.it \
  -smtp stdout
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/goatcounter

[Install]
WantedBy=multi-user.target
EOF
```

```bash
systemctl daemon-reload && systemctl enable --now goatcounter && curl -s -H "Host: stats.dovebus.it" localhost:8081/status
```

Now reload Caddy so the `stats.dovebus.it` block from §6 can get its certificate:

```bash
systemctl reload caddy && curl -s https://stats.dovebus.it/status
```

The site and its login. **`-smtp stdout` means no mail is ever sent**, so there
is no password reset: the password chosen here is the only way in.

```bash
sudo -u goatcounter goatcounter db create site -db "sqlite+/var/lib/goatcounter/db.sqlite3" -vhost stats.dovebus.it -user.email YOUR_EMAIL
```

### What it is allowed to collect

Set under *Settings → Data collection* on the dashboard, and these are choices
rather than defaults:

| Setting | State | Why |
|---|---|---|
| Individual pageviews | **off** | The one that matters. With it off no per-visit row is ever written — only hourly totals — so there is no archive to retain, to leak, or to promise a deletion window for. |
| Sessions | on | An in-memory hash of IP and User-Agent, held eight hours so a reload is not a second reader. Never written to disk; neither is the IP or the User-Agent. |
| Referrer | on | Where readers come from, which is half the point. |
| User-Agent | on | Browser and system *names*, derived; the header itself is not stored. |
| Size | on | Screen width, in bands. |
| Country | on | Country only. |
| Region | **off** | "Toscana" on a map of Tuscany is not information. It is also off at the source: the dashboard greys the option out, because region needs the "Cities" GeoIP database and the `-geodb` flag, and this install has neither. Country works because GoatCounter carries a country-level database itself. |
| Language | **off** | Not needed, and one more thing that narrows a crowd. |
| Data retention | **unset** | Deliberate, and it is not the lax choice. GoatCounter's retention deletes the *aggregates* too, so a 90-day window would throw away the year-on-year trend this exists to produce. With individual pageviews off there is nothing personal left to expire. |
| Public statistics | **public** | The privacy page claims what is counted; this is what makes the claim checkable by the people it is about. |

## 9. Proving it works

```bash
curl -s https://api.dovebus.it/healthz | head -c 400
```

From your own machine, against the deployed site — this drives every page in a
real browser through the real headers and fails on anything the CSP blocked. It
also asks each page two questions about the counter: did it count, and did it
leave anything behind. A cookie, a `localStorage` key or a `sessionStorage` key
on any page fails the run, because that is the privacy page's plainest promise
and this is the only place it is checked by asking a browser rather than by
reading the source.

```bash
HEADERS_BASE=https://dovebus.it npm run headers-check
```

Pointed at a local preview instead, the "did it count" half is skipped on
purpose: the counter refuses private addresses, so no beacon is *supposed* to
fire there, and demanding one would be demanding it misbehave. The storage half
is checked either way.

Then open `https://dovebus.it/mappa/` and watch a bus move. That is the only
test that covers everything at once.

**Two things will look broken and are not.** A DNS provider can publish records
several minutes after its own panel shows them, and a record's old TTL still has
to expire in every resolver that cached it — so the site can be complete, with a
valid certificate, and still unreachable by name for the best part of an hour.
Before debugging any of it, check what the *authoritative* server says
(`dig +short @its-nameserver dovebus.it A`) and try the destination directly
(`curl --resolve dovebus.it:443:THE_IP https://dovebus.it/`). If those two are
right, nothing is wrong and the answer is to wait.

## 10. Search engines

The site was live for four days before anyone checked whether a search engine
knew it existed, and none did: `site:dovebus.it` returned nothing, and there was
no property in Search Console to ask. Nothing was broken — `robots.txt`, the
sitemap, the canonicals and the `hreflang` pairs were all correct from the first
deploy. They were simply never *announced*, and a domain with no inbound links is
not discovered on its own.

Three of the four steps below happen in somebody's browser, once, and cannot be
scripted. The fourth is a script, and it runs after every deploy.

### Google Search Console — once

1. <https://search.google.com/search-console> → add property → **Domain**
   (the left-hand option), enter `dovebus.it`.
2. It gives you a `TXT` record. Add it at Aruba on the apex.
3. **Wait.** Aruba publishes several minutes after its own panel says it has, and
   the records carry a one-hour TTL — verifying too early fails and tells you
   nothing useful. `dig +short TXT dovebus.it` is the honest check; verify once it
   answers.
4. Choose **Domain**, not URL-prefix: one property then covers `dovebus.it`,
   `www`, `api.` and `stats.` together, and the `www` and Netlify hosts are the
   ones that would otherwise be invisible when something goes wrong on them.
5. Sitemaps → submit `sitemap.xml`.
6. URL Inspection → paste each of the ten URLs → **Request indexing**. Tedious,
   and on a small clean site it is still the fastest route in.

### Bing Webmaster Tools — once

<https://www.bing.com/webmasters> → **Import from Google Search Console**, which
carries the property and the sitemap across without repeating the DNS step. Worth
the five minutes it costs: Bing also answers for DuckDuckGo, Copilot and
ChatGPT's search.

### IndexNow — after every deploy

`npm run indexnow` announces the deployed URLs to Bing, Yandex, Seznam and Naver
in one request. **Google does not participate**, so this is the other half of
Search Console, not a replacement for it.

```bash
npm run indexnow
```

```bash
npm run indexnow -- --dry   # verify the deploy, send nothing
```

**Run it after the deploy is live, never from the build.** A Netlify build
finishes *before* its output is published, so a ping fired from inside the build
announces pages whose new content is not there yet — the engine fetches the old
one and marks it seen. That is why this is a command you run and not a build
step.

It refuses rather than guesses. Before submitting anything it reads two files off
the production origin: the key file, whose contents must equal the key it is
about to send, and `sitemap.xml`, which is where the URL list comes from — so a
page added to `PAGES` is submitted on the next run with nothing to edit here. If
the deploy is not live yet it says so and exits 1:

```
FAIL — key file https://dovebus.it/<key>.txt returned 404.
       The deploy carrying it is not live yet.
```

`202` is a success, but a weaker one than `200`: it means the submission was
taken and the key has not been read yet. If runs keep returning `202` and nothing
is ever crawled, the key file is unreachable in some way this script's own fetch
cannot see, and the thing to check is whether it is served on the real edge.

The key lives in `client/indexnow.ts` and **is not a secret** — the protocol
publishes it at `https://dovebus.it/<key>.txt` by design. It must stay *stable*:
verification happens when an engine gets round to crawling, so changing the key
invalidates every submission still in flight.

### The Netlify subdomain

`dovebus.netlify.app` used to serve a complete, crawlable second copy of the
site — 200 on every path, with its own `robots.txt` saying `Allow: /`. The pages
did carry a canonical pointing here, which is why it was a duplicate and not an
outage, but a canonical is a hint an engine may decline. The last rule in
`client/public/_redirects` now folds that host into the apex with a
host-qualified `301!`. Deploy previews and branch deploys have different
hostnames and are untouched.

That rule names the production origin literally, because `_redirects` is a static
file and `SITE_URL` is a build input. The build refuses rather than letting it
rot: change `SITE_URL` without updating that line and it fails with

```
public/_redirects points at https://dovebus.it/:splat, but this build publishes
https://example.org — update the redirect, or the deployed site sends every page
to the wrong domain
```

## Living with it

```bash
journalctl -u dovebus-api -f          # what the API is doing
```

```bash
journalctl -u goatcounter -f          # what the counter is doing
```

```bash
systemctl list-timers dovebus-refresh # when the timetable next rebuilds
```

```bash
curl -s https://api.dovebus.it/healthz
```

`/healthz` is the one thing worth watching. `degraded` means either the loaded
timetable has expired, or too many buses on the road are running trips it has
never heard of — the second is the signal that noticed a mid-window republish
that every expiry check had missed.

**Updating the app:**

```bash
cd /srv/dovebus && sudo -u dovebus git pull && sudo -u dovebus npm ci --omit=dev && systemctl restart dovebus-api
```

A schema change is the only case that also needs `npm run import`; `/healthz`
says `staleSchema` when that is what happened.

**Backing up the counter.** It is the only data on this machine that cannot be
rebuilt from somewhere else: the timetable is re-downloaded every night from the
operator, and the site is in git, but nobody else has these numbers. Use SQLite's
own backup rather than `cp` — the file is being written to while you read it:

```bash
sudo -u goatcounter sqlite3 /var/lib/goatcounter/db.sqlite3 ".backup /var/lib/goatcounter/backup.sqlite3" && sudo gzip -f /var/lib/goatcounter/backup.sqlite3
```

Then copy `backup.sqlite3.gz` off the machine. `.backup` rather than `cp`
because the database runs in WAL mode: there is a `-wal` file beside it holding
writes that have not landed yet, and copying the one file without the other
copies a database that is missing its most recent hours.

**Updating the counter.** Releases are roughly twice a year and the binary is
self-contained, so this is a download, a checksum, and a restart. Take a backup
first: `-automigrate` is deliberately *not* in the unit, so migrations are a
thing you run and watch rather than something that happens during a restart.

```bash
cd /tmp && curl -fsSL -o gc.gz https://github.com/arp242/goatcounter/releases/download/vX.Y.Z/goatcounter-vX.Y.Z-linux-amd64.gz && gzip -dc gc.gz > goatcounter && sha256sum goatcounter
```

```bash
systemctl stop goatcounter && install -o root -g root -m 755 /tmp/goatcounter /usr/local/bin/goatcounter && sudo -u goatcounter goatcounter db migrate -db "sqlite+/var/lib/goatcounter/db.sqlite3" all && systemctl start goatcounter && curl -s https://stats.dovebus.it/status
```

Record the new digest in §8 when you do, so the next upgrade has something to
check against.
