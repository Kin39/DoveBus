# Deploying DoveBus

Two machines and one domain.

```
dovebus.it        →  Netlify         static pages, built from client/
api.dovebus.it    →  a small VPS     Caddy (TLS) → Node on 127.0.0.1:3200 → SQLite
```

The frontend is a bundle of files; the API is one always-on process holding a
1.2 GB timetable and two realtime pollers. Nothing else is running: no database
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
  or the certificate request fails.
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

Wait until this answers with your server's address:

```bash
dig +short api.dovebus.it
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
EOF
```

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

**All three are baked into the build**, not read at runtime — `VITE_API_BASE`
ends up inside the JavaScript *and* inside the `connect-src` of the generated
`_headers`. Change either and you rebuild; the build refuses to publish a CSP
that names an API the bundle does not call.

Then point the apex domain at Netlify (their dashboard gives you the records)
and deploy.

## 8. Proving it works

```bash
curl -s https://api.dovebus.it/healthz | head -c 400
```

From your own machine, against the deployed site — this drives every page in a
real browser through the real headers and fails on anything the CSP blocked:

```bash
HEADERS_BASE=https://dovebus.it npm run headers-check
```

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

## Living with it

```bash
journalctl -u dovebus-api -f          # what the API is doing
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

**Updating:**

```bash
cd /srv/dovebus && sudo -u dovebus git pull && sudo -u dovebus npm ci --omit=dev && systemctl restart dovebus-api
```

A schema change is the only case that also needs `npm run import`; `/healthz`
says `staleSchema` when that is what happened.
