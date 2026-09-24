# Docker Compose Stack

A comprehensive Docker Compose stack featuring essential services for home server management, monitoring, media, and utilities.

## Services Overview

### 🔍 Dozzle
**Port:** 8080  
Real-time Docker container log viewer with a clean web interface.
- Access at: `http://localhost:8080`

### 📁 FileBrowser
**Port:** 8081  
Web-based file manager for browsing and managing files.
- Access at: `http://localhost:8081` (container listens on 8070)
- Files served from: `./filebrowser/data`

### 🏠 Homepage
**Port:** 3000  
Customizable dashboard for organizing your services and links.
- Access at: `http://localhost:3000`
- Configuration: `./homepage/config`, custom icons: `./homepage/icons`

### 🛡️ Pi-hole
**Ports:** 53 (DNS, TCP+UDP), 80 (HTTP)  
Network-wide ad blocker and DNS server.
- Web interface: `http://localhost/admin`
- Query log retention: 30 days (`MAXDBDAYS`)

### 📺 Pinchflat
**Port:** 8945  
YouTube downloader and subscription manager.
- Access at: `http://localhost:8945`
- Downloads saved to: `./pinchflat/downloads`

### 🐳 Dockhand
**Port:** 3001  
Docker container management UI for monitoring and managing containers.
- Access at: `http://localhost:3001` (container listens on 3000)

### 📄 Stirling PDF
**Port:** 8090  
Self-hosted PDF manipulation tools (merge, split, convert, etc.).
- Access at: `http://localhost:8090`
- Security disabled for local use

### 🔄 WUD (What's up Docker)
**Port:** 3033  
Checks for image updates, applies them, and emails on every new version found. Replaces Watchtower.
- Access at: `http://localhost:3033` (container listens on 3000)
- Basic auth: user `gadol`, password from `WUD_AUTH_ADMIN_PASSWORD`
- State stored in: `./wud/data`
- Scans every 2 hours (`WUD_WATCHER_LOCAL_CRON=0 */2 * * *`)
- Watches digests as well as tags (`WATCHDIGESTDEFAULT=true`), required to detect updates on `:latest`
- Pulls and recreates containers automatically, pruning the old images
- Excluded from its own auto-update trigger (`wud.trigger.exclude=docker.local`): WUD 9.0.2 has no self-update guard and would stop its own container mid-swap. Bump it manually with `docker compose pull wud && docker compose up -d wud`
- Sends one email per detected update (Gmail, implicit TLS on port 465 — see [Testing email](#testing-email))
- Sends one Telegram message per detected update (bot `@the_gadol_bot` — see [Testing Telegram](#testing-telegram))
- Authenticates to ghcr with a GitHub PAT (`read:packages`); anonymous tag-list queries against large repos such as Immich return HTTP 429 and the check is skipped
- See [Updates](#updates) for per-container opt-outs

### 🔒 WireGuard (wg-easy)
**Ports:** 51820 (VPN, UDP), 51821 (Web UI, TCP)  
Self-hosted VPN server with a web UI for managing peers.
- Web UI: `http://localhost:51821`
- `WG_HOST` is set in `docker-compose.yml` — change it to your own public hostname/IP

### 📹 go2rtc (splitcam)
**Ports:** 1984 (Web UI/API), 8554 (RTSP), 8555 (WebRTC, TCP+UDP)  
Camera stream server that re-publishes RTSP cameras as WebRTC/RTSP/HLS.
- Web UI: `http://localhost:1984`
- Config: `./splitcam/config/go2rtc.yaml` (two streams, `camera1` and `camera2`)
- Camera credentials and IPs come from the `CAMERA_*` environment variables
- WebRTC candidates are hardcoded to `192.168.1.200:8555` in the config — update for your host

### 🖥️ Splitcam web
**Port:** 8082  
Static camera viewer (nginx) that proxies `/api/` to go2rtc.
- Access at: `http://localhost:8082`
- Served from: `./splitcam/index.html`, nginx config `./splitcam/nginx.conf`

### ✂️ Cutter
**Port:** 8083  
Image background removal (rembg) and print bleed tool. Built from source in `./cutter`.
- Access at: `http://localhost:8083`
- `cutter-frontend` (nginx + React) proxies `/remove-bg`, `/add-bleed`, `/health` to `cutter-backend` (FastAPI, internal :8000)
- First build downloads the `u2net` model (~170MB) and bakes it into the image (~3-5 min)
- Excluded from WUD entirely via `wud.watch=false` (locally built images have no registry to check)

### 🎬 Emby
**Ports:** 8096 (HTTP), 8920 (HTTPS)  
Media server with hardware transcoding and CIFS/SMB media libraries.
- Access at: `http://localhost:8096`
- Config: `./emby/config`
- Hardware transcode via `/dev/dri` — remove the `devices:` block if the host has no iGPU
- `GIDLIST=1000,44,993` maps the container user into the host `video` (44) and `render` (993) groups; check your host's group IDs with `getent group video render`
- Libraries are named Docker volumes mounted over CIFS from `//192.168.1.2` (Movies, Movies 2, Movies 3, Movies 4, Movies 4k, Series, Music, Camera)

### 📊 Glances
**Port:** 61208  
System monitoring dashboard (CPU, memory, disk, containers).
- Access at: `http://localhost:61208`
- Runs with `pid: host` and a read-only Docker socket

### 📈 Uptime Kuma + AutoKuma
**Port:** 3002  
Uptime monitoring for every container in this stack, with alerts on Telegram.
- Access at: `http://localhost:3002` (container listens on 3001; 3001 on the host is Dockhand)
- State stored in: `./uptime-kuma/data`
- Image is `louislam/uptime-kuma:2` — `:latest` is still 1.23. See [Rolling major tags](#rolling-major-tags-immich) for the `wud.tag.transform` label that lets WUD update it
- Monitors, the Telegram notification and the Docker host are **not** created in the UI. AutoKuma (`ghcr.io/bigboot/autokuma`) reads `kuma.*` labels from the containers and syncs them into Uptime Kuma every 5 seconds. Anything created by hand in the UI is left alone
- See [Monitoring](#monitoring) for first-time setup and how to add a monitor

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2.0+
- `cifs-utils` on the host (required for the Emby media volumes)
- An iGPU at `/dev/dri` for Emby hardware transcoding (optional)

## Environment Variables

Create a `.env` file in the same directory as your `docker-compose.yml`:

```env
# Homepage Configuration
HOMEPAGE_ALLOWED_HOSTS=
FILEBROWSER_USERNAME=admin
FILEBROWSER_PASSWORD=changeme

# Pi-hole Configuration
PIHOLE_TZ=America/New_York
PIHOLE_WEBPASSWORD=your_secure_password
PIHOLE_SERVERIP=192.168.1.100

# WireGuard (wg-easy) Configuration
WIREGUARD_PASS_HASH=your_bcrypt_password_hash

# WUD Email Notifications
WUD_EMAIL_USER=your_gmail_address
WUD_EMAIL_PASSWORD=your_gmail_app_password
WUD_EMAIL_FROM=your_gmail_address
WUD_EMAIL_TO=notify_address

# WUD Configuration
WUD_AUTH_ADMIN_PASSWORD=your_secure_password

# WUD Telegram Notifications
TELEGRAM_BOT_TOKEN=123456789:your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# GitHub Container Registry (read:packages PAT, avoids ghcr rate limiting)
GHCR_USERNAME=your_github_username
GHCR_TOKEN=ghp_your_read_packages_token

# Cameras (go2rtc / splitcam)
CAMERA_USER=camera_username
CAMERA_PASSWORD=camera_password
CAMERA1_IP=192.168.1.x
CAMERA2_IP=192.168.1.y

# Emby media shares (CIFS/SMB)
SMB_USER=nas_username
SMB_PASS=nas_password

# Uptime Kuma admin account, used by AutoKuma to log in
UPTIME_KUMA_USERNAME=admin
UPTIME_KUMA_PASSWORD=your_secure_password
```

### Required Variables:
- `PIHOLE_TZ`: Your timezone (e.g., America/New_York, Europe/London)
- `PIHOLE_WEBPASSWORD`: Password for Pi-hole admin interface
- `PIHOLE_SERVERIP`: Your server's IP address
- `WIREGUARD_PASS_HASH`: bcrypt hash for wg-easy web UI password
- `WUD_AUTH_ADMIN_PASSWORD`: Password for the WUD web UI
- `CAMERA_USER`, `CAMERA_PASSWORD`, `CAMERA1_IP`, `CAMERA2_IP`: RTSP credentials and addresses for go2rtc
- `SMB_USER`, `SMB_PASS`: Credentials for the CIFS shares backing the Emby libraries
- `UPTIME_KUMA_USERNAME`, `UPTIME_KUMA_PASSWORD`: The Uptime Kuma admin account. AutoKuma logs in with it; create the account in the UI with exactly these values

### Optional Variables:
- `HOMEPAGE_ALLOWED_HOSTS`: Allowed hostnames for Homepage (leave empty for all)
- `FILEBROWSER_USERNAME`: FileBrowser username (default: admin)
- `FILEBROWSER_PASSWORD`: FileBrowser password
- `GHCR_USERNAME`, `GHCR_TOKEN`: GitHub username and a PAT with `read:packages` scope, used by WUD to avoid ghcr rate limiting
- `WUD_EMAIL_USER`, `WUD_EMAIL_PASSWORD`, `WUD_EMAIL_FROM`, `WUD_EMAIL_TO`: SMTP notification settings for WUD (Gmail). These are read by Docker Compose on the host and substituted into the `WUD_TRIGGER_SMTP_GMAIL_*` variables; WUD itself never sees them under these names. Write them literally — WUD passes the username straight to SMTP, so a URL-encoded address such as `liorgadol%40gmail.com` (as Watchtower's shoutrrr URL required) is rejected with `535-5.7.8 Username and Password not accepted`. `WUD_EMAIL_PASSWORD` is a Gmail app password, not the account password.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: Telegram notification settings for WUD and Uptime Kuma. The token comes from @BotFather. For the chat id, send the bot any message first (a bot cannot message a user who never started it), then read it from `curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | jq '.result[-1].message.chat.id'`. An empty `result` means the bot has not received a message yet.

Note: several containers (WUD, wg-easy, Emby, Uptime Kuma) have `TZ=Asia/Jerusalem` hardcoded in `docker-compose.yml`. Pinchflat reuses `PIHOLE_TZ`.

## Quick Start

1. Clone or download this repository
2. Create the `.env` file with your configuration
3. Start all services:
   ```bash
   docker compose up -d
   ```

4. Check service status:
   ```bash
   docker compose ps
   ```

5. View logs:
   ```bash
   docker compose logs -f [service_name]
   ```

## Directory Structure

The stack will create the following directories for persistent data:

```
.
├── docker-compose.yml
├── .env
├── README.md
├── autokuma/
│   └── data/               # AutoKuma id map — do not delete (see Monitoring)
├── cutter/                 # Cutter source (Dockerfile.backend, Dockerfile.frontend, frontend/)
├── dockhand/
│   └── data/
├── emby/
│   └── config/
├── filebrowser/
│   ├── config/
│   ├── data/
│   └── database/
├── homepage/
│   ├── config/
│   └── icons/
├── pihole/
│   ├── etc-pihole/
│   └── etc-dnsmasq.d/
├── pinchflat/
│   ├── config/
│   └── downloads/
├── scripts/
│   └── emby-backup.sh
├── splitcam/
│   ├── config/go2rtc.yaml
│   ├── index.html
│   └── nginx.conf
├── stirlingtools/
│   ├── configs/
│   └── customFiles/
├── uptime-kuma/
│   └── data/
├── wgeasy/
│   └── config/
└── wud/
    └── data/
```

Emby media libraries are not directories here — they are named Docker volumes mounted from the NAS over CIFS.

## Management Commands

### Start all services
```bash
docker compose up -d
```

### Stop all services
```bash
docker compose down
```

### Restart a specific service
```bash
docker compose restart [service_name]
```

### Update all containers
WUD handles this automatically, but you can also manually update:
```bash
docker compose pull
docker compose up -d
```

### Rebuild the locally built services (Cutter)
```bash
docker compose build cutter-backend cutter-frontend
docker compose up -d cutter-backend cutter-frontend
```

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f dozzle
```

## Service Access URLs

| Service | URL | Notes |
|---------|-----|-------|
| Dozzle | http://localhost:8080 | Log viewer |
| FileBrowser | http://localhost:8081 | File manager |
| Homepage | http://localhost:3000 | Dashboard |
| Pi-hole | http://localhost/admin | Ad blocker |
| Pinchflat | http://localhost:8945 | YouTube downloader |
| Dockhand | http://localhost:3001 | Docker management |
| Stirling PDF | http://localhost:8090 | PDF tools |
| WUD | http://localhost:3033 | Image update checker + auto-updater |
| wg-easy | http://localhost:51821 | WireGuard VPN management |
| go2rtc | http://localhost:1984 | Camera stream server |
| Splitcam web | http://localhost:8082 | Camera viewer |
| Cutter | http://localhost:8083 | Background removal / bleed |
| Emby | http://localhost:8096 | Media server |
| Glances | http://localhost:61208 | System monitoring |
| Uptime Kuma | http://localhost:3002 | Uptime monitoring + Telegram alerts |

Non-HTTP ports: Pi-hole DNS on 53/tcp+udp, WireGuard on 51820/udp, go2rtc RTSP on 8554 and WebRTC on 8555/tcp+udp, Emby HTTPS on 8920.

## Port Conflicts

If you encounter port conflicts, modify the ports in `docker-compose.yml`:

```yaml
ports:
  - "NEW_PORT:CONTAINER_PORT"
```

For example, to change Dozzle from port 8080 to 8082:
```yaml
ports:
  - "8082:8080"
```

## Backup

Important directories to backup:
- `./filebrowser/` - FileBrowser data and configuration
- `./homepage/config/` - Homepage dashboard configuration
- `./pihole/` - Pi-hole configuration and blocklists
- `./pinchflat/config/` - Pinchflat subscriptions
- `./stirlingtools/configs/` - Stirling PDF settings
- `./dockhand/data/` - Dockhand configuration
- `./wgeasy/config/` - WireGuard peer configs and keys
- `./wud/data/` - WUD state
- `./splitcam/config/` - go2rtc stream definitions
- `./emby/config/` - Emby settings, library definitions and metadata
- `./uptime-kuma/data/` - Uptime Kuma database (monitor history, admin account)
- `./autokuma/data/` - AutoKuma's map of label ids to Uptime Kuma ids; back it up together with `./uptime-kuma/data/`

### Emby config backup script

`scripts/emby-backup.sh` stops Emby, tars the whole config tree, verifies the archive, restarts the container and prunes old archives.

```bash
./scripts/emby-backup.sh
```

Defaults (override with environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONFIG_DIR` | `/opt/docker/homelab/emby/config` | Emby config tree to archive |
| `BACKUP_DIR` | `/mnt/emby_backup` | Where archives and `emby-backup.log` are written |
| `CONTAINER` | `emby` | Container to stop/start |
| `KEEP` | `3` | Number of archives to retain |
| `STOP_TIMEOUT` | `60` | Seconds to wait for a clean shutdown |
| `ENV_FILE` | `/opt/docker/homelab/.env` | Where `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are read from |

On any failure (preflight, stop, tar, verification, or an unexpected error) it sends a Telegram
message with the reason, and a separate one if Emby does not start again afterwards. Success is
silent. cron does not load the compose `.env`, so the script reads the two Telegram values from
`ENV_FILE` itself; values already in the environment take precedence. Without them it logs a
warning and skips the notification. A failed notification never fails the backup.

The root check is disabled: it runs as root or as a user in the `docker` group that can read the whole config tree and write to `BACKUP_DIR`. A file it cannot read fails the tar step, which sends the Telegram alert. Example cron entry (daily at 04:00):

```cron
0 4 * * * /opt/docker/homelab/scripts/emby-backup.sh
```

## Troubleshooting

### Container won't start
```bash
docker compose logs [service_name]
```

### Permission issues
Ensure the directories have proper ownership:
```bash
sudo chown -R $USER:$USER .
```

### Reset a service
```bash
docker compose stop [service_name]
docker compose rm -f [service_name]
docker compose up -d [service_name]
```

### Pi-hole not blocking ads
1. Configure your router or devices to use Pi-hole's IP as DNS server
2. Set Pi-hole's IP to your server's IP address in the `.env` file

### Emby media volumes won't mount
CIFS volumes are mounted by the Docker daemon at container start, so a bad credential or an unreachable NAS shows up as a failure to start Emby.
```bash
docker compose logs emby
docker volume inspect homelab_movies
```
Check that `cifs-utils` is installed, `SMB_USER`/`SMB_PASS` are correct, and the share names in `docker-compose.yml` match the NAS. Removing a volume requires `docker compose down` first, then `docker volume rm`.

### Emby hardware transcoding fails
Verify `/dev/dri` exists on the host and that the `GIDLIST` values match the host's `video` and `render` groups:
```bash
ls -l /dev/dri
getent group video render
```

### Camera streams show no video
```bash
docker compose logs go2rtc
```
Check the RTSP URL works directly (`ffprobe rtsp://user:pass@ip:554/stream1`), and update the WebRTC `candidates` in `splitcam/config/go2rtc.yaml` to the host's LAN IP.

## Security Considerations

- Change all default passwords immediately
- Pi-hole runs on the standard HTTP port (80) - consider using a reverse proxy
- Stirling PDF has security disabled - enable if exposing to internet
- Consider placing services behind a VPN if accessing remotely (wg-easy is included for this)
- Several services (Dozzle, Homepage, Dockhand, WUD, Glances, Uptime Kuma, AutoKuma) mount `/var/run/docker.sock` - anyone with access to those containers has effective root on the host
- go2rtc's API is configured with `origin: "*"` and no authentication - do not expose port 1984 to the internet
- The Telegram bot token is interpolated into an AutoKuma label, so it shows in `docker inspect autokuma` (it is already visible in `docker inspect wud` as an environment variable)
- Camera and NAS credentials live in `.env` and are interpolated into stream URLs and mount options - keep `.env` out of version control (it is already in `.gitignore`)

## Monitoring

Uptime Kuma checks every container in this stack and sends a Telegram message when one
goes down and when it comes back. The monitors are defined as labels in
`docker-compose.yml`; AutoKuma turns them into Uptime Kuma monitors.

Each service has up to two monitors:

| Monitor | Type | What it checks |
|---|---|---|
| `<Service>` | Docker container | Container is running (and healthy, if it has a healthcheck), read through the Docker socket |
| `<Service> web` | HTTP | The web UI answers on `http://192.168.1.200:<port>` with a 2xx after redirects |

Extras: `Pi-hole DNS` resolves `google.com` through Pi-hole on port 53, `WUD web` hits the
unauthenticated `/health` endpoint (the UI itself answers 401), `Emby web` hits
`/web/index.html`. `Cutter backend` has no published port, so it only gets the container
check. AutoKuma monitors its own container; Uptime Kuma does not monitor itself, since it
could not alert about its own outage.

Every monitor gets the same defaults from `AUTOKUMA__DEFAULT_SETTINGS`: notify the
`telegram` notification, check containers through the `local` Docker host, and retry twice
(60s apart) before going down, so a WUD pull-and-recreate does not page.

### First-time setup

AutoKuma cannot create the Uptime Kuma admin account, so the first start is two steps:

1. Add `UPTIME_KUMA_USERNAME` and `UPTIME_KUMA_PASSWORD` to `.env`, then start both:
   ```bash
   docker compose up -d uptime-kuma autokuma
   ```
2. Open `http://192.168.1.200:3002` and create the admin account with exactly those
   values. Until then AutoKuma logs `authIncorrectCreds` and keeps retrying. If the sync
   below shows nothing after a minute, `docker compose restart autokuma`.

Check the sync:

```bash
docker logs autokuma 2>&1 | grep -E "Creating|WARN|ERROR"
```

First you see `Creating new notification: telegram` and `Creating new docker_host: local`,
then one `Creating new ...` per monitor. A few `Cannot create X because referenced
notification with name telegram is not found` warnings on the first pass are normal —
monitors are retried after the notification exists.

To test Telegram, open the Telegram notification under **Settings → Notifications** and
press **Test**, or stop any container for about three minutes.

### Adding a monitor

Add labels to the service and recreate it. The id (`myapp` below) must be unique across
the whole file; the name is what shows in Uptime Kuma and in the Telegram message.

```yaml
labels:
  - "kuma.myapp.docker.name=My App"
  - "kuma.myapp.docker.docker_container=myapp"
  - "kuma.myapp-web.http.name=My App web"
  - "kuma.myapp-web.http.url=http://192.168.1.200:1234/"
```

What happens to a monitor whose labels disappear is set by `AUTOKUMA__ON_DELETE`
(`delete` or `keep`). Other monitor types and settings: <https://autokuma.bigboot.dev/dev/entity-types/overview/>.

### Gotchas

- **Do not delete `./autokuma/data`.** It maps label ids to Uptime Kuma ids. Without it
  AutoKuma creates every monitor, the notification and the Docker host a second time,
  next to the old ones.
- **The Telegram config carries `"isDefault":false,"applyExisting":false`** on purpose.
  Uptime Kuma adds those keys when it stores a notification; if the label leaves them
  out, AutoKuma sees a difference on every pass and logs `Updating notification:
  telegram` every 5 seconds forever.
- **`AUTOKUMA__DEFAULT_SETTINGS` must start on the same line as the `=`.** A leading
  newline makes AutoKuma exit with `Invalid config: Found invalid config
  'kuma.default_settings'`.
- **Change label-managed monitors through the labels, not the UI.** AutoKuma writes the
  label values back when it sees a difference, as with the notification above.

## Updates

WUD scans every 2 hours, emails once per newly detected version, then pulls the new image and recreates the container.

Two per-container opt-outs, set as Docker labels:

**Monitor only** — still scanned, still emailed, never updated. The replacement for Watchtower's `monitor-only=true`:

```yaml
labels:
  - "wud.trigger.exclude=docker.local"
```

`docker.local` is the auto-update trigger's id (`{type}.{name}`); the `smtp.gmail` email trigger still applies. Immich uses this.

**Ignore completely** — not scanned, not emailed, not updated:

```yaml
labels:
  - "wud.watch=false"
```

Five containers carry this label:

| container | reason |
|---|---|
| `cutter_backend`, `cutter_frontend` | built locally, no registry to check |
| `immich_nginx_proxy` | plain `nginx:alpine`; was already excluded under Watchtower |
| `immich_redis` | pinned `valkey:9@sha256:...`; Immich bumps it with its own releases |
| `immich_postgres` | pinned `postgres:14-...@sha256:...`; a major bump will not start against an older data directory |

Watchtower ignored the two pinned database images for free — a `@sha256:` reference is
immutable, so there was never anything to update. WUD reads the *tag* instead and would
find `valkey:10` or `postgres:15` as candidates, so the label is doing real work here.

### Testing email

The SMTP trigger can be fired by hand against a made-up container, which exercises the
real credentials without waiting for an update:

```bash
P=$(grep '^WUD_AUTH_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "gadol:$P" \
  -X POST http://localhost:3033/api/triggers/smtp/gmail \
  -H 'Content-Type: application/json' \
  -d '{"name":"email-test","watcher":"local","updateKind":{"kind":"tag","localValue":"1.0.0","remoteValue":"1.0.1","semverDiff":"patch"},"result":{}}'
```

An empty response plus `Trigger executed with success` in `docker logs wud` means the mail
was accepted by Gmail. This bypasses the `once` bookkeeping, so it does not disturb real
notification state. Note that a healthy-looking `[trigger.smtp.gmail] Register with
configuration {...}` line at startup proves nothing — registration only validates the
shape of the config, never that mail can be delivered.

### Testing Telegram

Same approach as email, against the `telegram.bot` trigger:

```bash
P=$(grep '^WUD_AUTH_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "gadol:$P" \
  -X POST http://localhost:3033/api/triggers/telegram/bot \
  -H 'Content-Type: application/json' \
  -d '{"name":"telegram-test","watcher":"local","updateKind":{"kind":"tag","localValue":"1.0.0","remoteValue":"1.0.1","semverDiff":"patch"},"result":{}}'
```

A message on the phone plus `Trigger executed with success` in `docker logs wud` means it
works. If the trigger fails with `chat not found`, the bot was never started from that chat.

### Rolling major tags (Immich)

Immich runs `ghcr.io/immich-app/immich-server:v3` — a rolling tag that is repointed at
each release rather than renamed. WUD skips digest checking for any tag it can parse as
semver, and `v3` coerces to `3.0.0`, so it would compare `v3` to `v3` forever and never
report an update. A `wud.watch.digest=true` label does not help: that check lives inside
an `if (!isSemver)` branch in the watcher.

The fix is to make the tag unparseable as semver, which the transform runs early enough
to do:

```yaml
labels:
  - "wud.trigger.exclude=docker.local"
  - 'wud.tag.transform=^v\d+()$$ => rolling$$1'
```

`v3` transforms to `rolling`, which has no digits and so is not semver, and digest
watching switches on. The real tag is untouched — only the semver test sees the
transformed value. The empty `()` matters: the transform function throws and silently
falls back to the original tag when the replacement has no `$N` placeholder, so
`^v3$ => rolling` does nothing at all. Note also that *any* digit makes a tag semver,
so `rolling-3` would not work either.

These labels live in Immich's own compose file at `/opt/docker/immich`, not in this repo.

## Maintenance notes

**WUD never revises what it already knows about a container.** On each scan it looks the
container up by id and returns the stored record as-is; settings are only read when a
container is seen for the first time. Changing `WATCHDIGESTDEFAULT`, registry
credentials or similar therefore applies to *new* containers only — everything already
running keeps the behavior it was first parsed with, with no error or warning. Recreate
the affected containers, or delete their entries and rescan:

```bash
P=$(grep '^WUD_AUTH_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "gadol:$P" -X DELETE http://localhost:3033/api/containers/<id>
curl -s -u "gadol:$P" -X POST http://localhost:3033/api/containers/watch
```

**The container list is only as current as the last scan.** Recreating a container gives
it a new id, and WUD matches on id, so a freshly recreated container is missing from the
UI and the API until the next scan at the top of an even hour. This applies to the `wud`
container itself after a `docker compose up -d wud`. Force a scan rather than waiting:

```bash
P=$(grep '^WUD_AUTH_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "gadol:$P" -X POST http://localhost:3033/api/containers/watch
```

**The WUD website documents `main`, not the released image.** Options that exist there
may be rejected by the version actually running — `WUD_TRIGGER_DOCKER_LOCAL_SELFUPDATE`
is documented but unknown to 9.0.2, and made the entire docker trigger fail to register.
The digest "smart defaults" table does not match the code either. When behavior does not
match the docs, read the source at the matching tag:
`https://github.com/getwud/wud/tree/9.0.2/app`.

## License

This stack uses various open-source projects. Please refer to each project's license:
- [Dozzle](https://github.com/amir20/dozzle)
- [FileBrowser](https://github.com/filebrowser/filebrowser)
- [Homepage](https://github.com/gethomepage/homepage)
- [Pi-hole](https://github.com/pi-hole/pi-hole)
- [Pinchflat](https://github.com/kieraneglin/pinchflat)
- [Dockhand](https://github.com/fnsys/dockhand)
- [Stirling PDF](https://github.com/Stirling-Tools/Stirling-PDF)
- [WUD](https://github.com/getwud/wud)
- [wg-easy](https://github.com/wg-easy/wg-easy)
- [go2rtc](https://github.com/AlexxIT/go2rtc)
- [Emby](https://emby.media)
- [Glances](https://github.com/nicolargo/glances)
- [Uptime Kuma](https://github.com/louislam/uptime-kuma)
- [AutoKuma](https://github.com/BigBoot/AutoKuma)
