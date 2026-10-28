# Docker Compose Stack

A comprehensive Docker Compose stack featuring essential services for home server management, monitoring, media, and utilities.

## Services Overview

Every web UI has a local name, `http://<name>.gadol.lan` — see [Local DNS names](#local-dns-names).
The `localhost:<port>` addresses below keep working.

### 🌐 Caddy
**Ports:** 80 (HTTP), 443 (HTTPS, `immich.gadol.lan` only)  
Reverse proxy that maps each `*.gadol.lan` name to a service's published port.
- Config: `./caddy/Caddyfile`; apply edits with `docker compose restart caddy`
- `http://192.168.1.200/` answers `OK` (health check for Uptime Kuma)
- Admin API listens on `0.0.0.0:2019` inside the container for caddy/ui and Homarr, but is not published on the host: it has no authentication

### 🧭 caddy/ui
**Port:** 8084  
Web UI for the Caddy container above: Caddyfile editor with validation and version history, route manager, TLS and upstream status.
- Access at: `http://localhost:8084` or `http://caddy.gadol.lan`
- Login: username and password set on the setup screen at first visit, stored as hashes in `./caddy-ui/data/auth.json`. Until setup finishes, whoever opens the UI first can claim admin
- Lost the password: sign in with the recovery key shown once after setup. Lost both: delete only `auth.json` and repeat setup
- Sessions live in backend memory: restarting `caddy-ui-backend` logs everyone out
- Saves edit `caddy/Caddyfile` in place (`docker exec` + `tee` into the `caddy` container), then reload Caddy through its admin API. The Caddyfile stays the source of truth; commit UI edits to git like hand edits
- Data: `./caddy-ui/data` (login, instance list, Caddyfile history, settings)
- Mounts the Docker socket (root-equivalent on the host) to reach the Caddyfile

### 🔍 Dozzle
**Port:** 8080  
Real-time Docker container log viewer with a clean web interface.
- Access at: `http://localhost:8080`
- Data: `./dozzle/data` (users and settings)

### 📁 FileBrowser
**Port:** 8081  
Web-based file manager for browsing and managing files.
Runs [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser), the maintained fork of FileBrowser.
- Access at: `http://localhost:8081` (container listens on 80)
- Files served from: `./filebrowser/data`
- Config: `./filebrowser/config/config.yaml`; database: `./filebrowser/database/database.sqlite`
- Runs as UID 1000, so `./filebrowser/data` and `./filebrowser/database` must be writable by it (`sudo chown -R 1000:1000 filebrowser/data filebrowser/database`)
- Log in as `admin` with `FILEBROWSER_ADMIN_PASSWORD`. The password is re-applied on every start, so change it in `.env`, not in the UI

### 🧩 Homarr
**Port:** 7575  
Dashboard configured in the browser (drag-and-drop layout, apps and integrations added through forms).
- Access at: `http://localhost:7575`; the first visit runs the onboarding wizard that creates the admin account
- Data: `./homarr/appdata` (database, uploaded icons). Back this up; the config is not in git
- Requires `HOMARR_SECRET_ENCRYPTION_KEY` in `.env`

### 🛡️ Pi-hole
**Ports:** 53 (DNS, TCP+UDP), 8053 (HTTP)  
Network-wide ad blocker and DNS server. Also resolves `*.gadol.lan` to the host.
- Web interface: `http://localhost:8053/admin` or `http://pihole.gadol.lan`
- Query log retention: 30 days (`MAXDBDAYS`)
- Admin password from `PIHOLE_WEBPASSWORD`, applied as `FTLCONF_webserver_api_password` on every start, so change it in `.env`, not in the UI

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
Checks for image updates, applies them, and sends a Telegram message on every new version found.
- Access at: `http://localhost:3033` (container listens on 3000)
- Basic auth: user `gadol`, password from `WUD_AUTH_ADMIN_PASSWORD`
- State stored in: `./wud/data`
- Scans every 2 hours (`WUD_WATCHER_LOCAL_CRON=0 */2 * * *`)
- Watches digests as well as tags (`WATCHDIGESTDEFAULT=true`), required to detect updates on `:latest`
- Pulls and recreates containers automatically, pruning the old images
- Excluded from its own auto-update trigger (`wud.trigger.exclude=docker.local`): WUD 9.0.2 has no self-update guard and would stop its own container mid-swap. Bump it manually with `docker compose pull wud && docker compose up -d wud`
- Sends one Telegram message per detected update (bot `@the_gadol_bot` — see [Testing Telegram](#testing-telegram))
- Authenticates to ghcr with a GitHub PAT (`read:packages`); anonymous tag-list queries against large repos such as Immich return HTTP 429 and the check is skipped
- See [Updates](#updates) for per-container opt-outs

### 🔒 WireGuard (wg-easy)
**Ports:** 51820 (VPN, UDP), 51821 (Web UI, TCP)  
Self-hosted VPN server with a web UI for managing peers.
- Web UI: `http://localhost:51821` or `http://wg.gadol.lan`
- Runs v15 (`:15`; `:latest` stopped at v14). Public host, port and the admin login are set in the first-run setup wizard, other settings in the Admin Panel; they are stored in `./wgeasy/config`, not in `.env`
- `INSECURE=true` because the web UI is served over plain HTTP; v15 refuses logins over HTTP without it
- Uses the same `wud.tag.transform` label as Uptime Kuma so WUD tracks the rolling `:15` tag (see [Rolling major tags](#rolling-major-tags-immich))

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

### 🪄 withoutBG
**Port:** 8086  
Background removal web app with a built-in API ([withoutBG Open Weights v3](https://withoutbg.com/open-model), CPU image).
- Access at: `http://localhost:8086` or `http://withoutbg.gadol.lan` (container listens on 8080; 8080 on the host is Dozzle)
- API: `POST /api/v1/remove-background`; health at `/health`
- Stateless, no volumes: the ~1.5GB model is baked into the image, so the first pull is large

### 🛠️ Config Manager
**Port:** 8085  
Web editor (Monaco) for config files on the host. Built from source in `./configmng`.
- Access at: `http://localhost:8085`, user `gadol`, password `CONFIGMNG_PASSWORD`
- Only files declared as `CONFIG_<name>` in `docker-compose.yml` are visible; mount the file's folder, not the file (exception: `/etc/hosts`, single-file mount since `/etc` is too broad)
- Current files: LinuxExecBot `config.yaml`, `gadol` crontab, `/etc/hosts`
- `RESTART_<name>` runs on the host after "Save & restart" (e.g. `systemctl restart linuxexecbot`, or `docker restart <container>`)
- Crontab: use "Save & restart" — it touches `/var/spool/cron/crontabs` so cron reloads (plain Save is not picked up). `/etc/hosts` applies immediately
- YAML/JSON/TOML validated before save (crontab and hosts are not); backups (last 20 per file) and activity log in `./configmng/data`
- `privileged: true` + `pid: host`: root-equivalent on the host. LAN/VPN only
- Excluded from WUD via `wud.watch=false`

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

### 📉 Beszel
**Ports:** 8091 (hub web UI), 45876 (agent, host network)  
Lightweight server monitoring with history and alerts. Hub (`beszel`) plus an agent (`beszel-agent`) for this host.
- Access at: `http://localhost:8091` or `http://beszel.gadol.lan` (container listens on 8090; 8090 on the host is Stirling PDF)
- Data: `./beszel/data` (hub), `./beszel-agent/data` (agent)
- First run: create the admin account, then "Add System" with host `192.168.1.200`, port `45876`. Copy the public key shown there into `BESZEL_AGENT_KEY` in `.env` and run `docker compose up -d beszel-agent`

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
# FileBrowser admin password (user is admin)
FILEBROWSER_ADMIN_PASSWORD=changeme

# Homarr: 64 hex chars, generate with `openssl rand -hex 32`
HOMARR_SECRET_ENCRYPTION_KEY=

# Timezone for every container
TZ=Asia/Jerusalem

# Pi-hole Configuration
PIHOLE_WEBPASSWORD=your_secure_password

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

# Beszel: hub public key from its "Add System" dialog
BESZEL_AGENT_KEY=ssh-ed25519 AAAA...

# Uptime Kuma admin account, used by AutoKuma to log in
UPTIME_KUMA_USERNAME=admin
UPTIME_KUMA_PASSWORD=your_secure_password

# Config Manager login (user gadol); single-quote it if it contains "$"
CONFIGMNG_PASSWORD=your_secure_password
CONFIGMNG_SESSION_SECRET=
```

### Required Variables:
- `TZ`: Timezone for every container (e.g., Asia/Jerusalem, Europe/London). If unset, containers fall back to UTC
- `HOMARR_SECRET_ENCRYPTION_KEY`: Key Homarr encrypts integration credentials with (`openssl rand -hex 32`). Keep it stable: a new key makes the saved credentials unreadable
- `PIHOLE_WEBPASSWORD`: Password for the Pi-hole admin interface
- `WUD_AUTH_ADMIN_PASSWORD`: Password for the WUD web UI
- `CAMERA_USER`, `CAMERA_PASSWORD`, `CAMERA1_IP`, `CAMERA2_IP`: RTSP credentials and addresses for go2rtc
- `SMB_USER`, `SMB_PASS`: Credentials for the CIFS shares backing the Emby libraries
- `BESZEL_AGENT_KEY`: The Beszel hub's public key. The agent refuses hub connections until it is set
- `UPTIME_KUMA_USERNAME`, `UPTIME_KUMA_PASSWORD`: The Uptime Kuma admin account. AutoKuma logs in with it; create the account in the UI with exactly these values
- `CONFIGMNG_PASSWORD`: Password for the Config Manager `gadol` user. Single-quote the value if it contains `$`

### Optional Variables:
- `FILEBROWSER_ADMIN_PASSWORD`: Password for the FileBrowser `admin` user, re-applied on every start. If unset, FileBrowser generates one on first start and prints it in the container log
- `GHCR_USERNAME`, `GHCR_TOKEN`: GitHub username and a PAT with `read:packages` scope, used by WUD to avoid ghcr rate limiting
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: Telegram notification settings for WUD and Uptime Kuma. The token comes from @BotFather. For the chat id, send the bot any message first (a bot cannot message a user who never started it), then read it from `curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | jq '.result[-1].message.chat.id'`. An empty `result` means the bot has not received a message yet.
- `CONFIGMNG_SESSION_SECRET`: Keeps Config Manager logins across restarts (`openssl rand -hex 32`). If unset, a random one is made on each start

Note: every service reads `TZ` from `.env`. Images without timezone data (nginx:alpine, the cutter images) ignore it and stay on UTC. Glances also mounts the host's `/etc/localtime`.

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
├── beszel/
│   └── data/
├── beszel-agent/
│   └── data/
├── caddy/
│   ├── Caddyfile           # *.gadol.lan routes
│   ├── config/
│   └── data/
├── caddy-ui/
│   └── data/               # caddy/ui instances, Caddyfile history
├── configmng/              # Config Manager source (Dockerfile, app/)
│   └── data/               # backups + audit.log
├── cutter/                 # Cutter source (Dockerfile.backend, Dockerfile.frontend, frontend/)
├── dockhand/
│   └── data/
├── dozzle/
│   └── data/               # Dozzle users and settings
├── emby/
│   └── config/
├── filebrowser/
│   ├── config/
│   ├── data/
│   └── database/
├── homarr/
│   └── appdata/
├── pihole/
│   ├── etc-pihole/
│   └── etc-dnsmasq.d/
├── pinchflat/
│   ├── config/
│   └── downloads/
├── scripts/
│   ├── emby-backup.sh
│   └── homelab-backup.sh
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

Emby media libraries are not directories here — they are named Docker volumes mounted over CIFS from the Windows Server (192.168.1.2).

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

### Rebuild the locally built services (Cutter, Config Manager)
```bash
docker compose build cutter-backend cutter-frontend configmng
docker compose up -d cutter-backend cutter-frontend configmng
```

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f dozzle
```

## Service Access URLs

| Service | Local name | Port URL | Notes |
|---------|------------|----------|-------|
| caddy/ui | http://caddy.gadol.lan | http://localhost:8084 | Caddy web UI |
| Dozzle | http://dozzle.gadol.lan | http://localhost:8080 | Log viewer |
| FileBrowser | http://files.gadol.lan | http://localhost:8081 | File manager |
| Homarr | http://home.gadol.lan | http://localhost:7575 | Dashboard |
| Pi-hole | http://pihole.gadol.lan | http://localhost:8053/admin | Ad blocker |
| Pinchflat | http://pinchflat.gadol.lan | http://localhost:8945 | YouTube downloader |
| Dockhand | http://dockhand.gadol.lan | http://localhost:3001 | Docker management |
| Stirling PDF | http://pdf.gadol.lan | http://localhost:8090 | PDF tools |
| WUD | http://wud.gadol.lan | http://localhost:3033 | Image update checker + auto-updater |
| wg-easy | http://wg.gadol.lan | http://localhost:51821 | WireGuard VPN management |
| go2rtc | http://go2rtc.gadol.lan | http://localhost:1984 | Camera stream server |
| Splitcam web | http://cams.gadol.lan | http://localhost:8082 | Camera viewer |
| Cutter | http://cutter.gadol.lan | http://localhost:8083 | Background removal / bleed |
| withoutBG | http://withoutbg.gadol.lan | http://localhost:8086 | Background removal (open weights v3) |
| Config Manager | http://config.gadol.lan | http://localhost:8085 | Host config file editor |
| Emby | http://emby.gadol.lan | http://localhost:8096 | Media server |
| Glances | http://glances.gadol.lan | http://localhost:61208 | System monitoring |
| Beszel | http://beszel.gadol.lan | http://localhost:8091 | Server monitoring |
| Uptime Kuma | http://kuma.gadol.lan | http://localhost:3002 | Uptime monitoring + Telegram alerts |
| Router | http://router.gadol.lan | http://192.168.1.1 | Not in this stack |
| Access point | http://ap.gadol.lan | http://192.168.1.150 | Not in this stack |
| qBittorrent | http://torrent.gadol.lan | http://192.168.1.2:8090 | On the Windows Server, not in this stack |
| Immich | https://immich.gadol.lan | https://192.168.1.200:2284 | Not in this stack; redirects to ddnsfree, see below |

### Local DNS names

Pi-hole answers `gadol.lan` and every name under it with the host IP (`192.168.1.200`),
via `FTLCONF_misc_dnsmasq_lines` in `docker-compose.yml`. The request reaches Caddy on
port 80, which forwards it to the service's published port by name (`caddy/Caddyfile`).
Nothing is set in Pi-hole's "Local DNS Records" page: it has no wildcards.

- Devices must use Pi-hole as their DNS server (router DHCP setting). A device on any
  other resolver gets "not found" for these names.
- Over WireGuard the names only work if the peer's DNS is `192.168.1.200`. Otherwise use
  the port URLs.
- Plain HTTP, except `immich.gadol.lan`: public CAs do not issue certificates for `.lan`.
- Type `http://` the first time; browsers may treat a bare unknown name as a search.

#### HTTPS for immich.gadol.lan

`immich.gadol.lan` redirects to `https://liorgadol.ddnsfree.com:2284` instead of proxying.
Immich's nginx rate-limits by source IP and exempts only `192.168.0.0/16`; proxied requests
came from Caddy's Docker address, so the page's burst of asset requests got HTTP 429.

The name stays HTTPS because Immich's HSTS header reached browsers through the old proxy.
Caddy signs `immich.gadol.lan` with its own local CA (`tls internal`). Browsers warn until
the device trusts that CA's root certificate, created on Caddy's first start at
`caddy/data/caddy/pki/authorities/local/root.crt` (valid 10 years). Install it once per device:

- macOS: double-click it, then in Keychain Access set it to **Always Trust**
- iPhone/iPad: AirDrop or mail it, install the profile, then enable it under
  Settings → General → About → Certificate Trust Settings
- Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate
- Windows: open it → Install Certificate → Local Machine → Trusted Root Certification Authorities

Keep `caddy/data/` private: it holds the CA's private key, which can sign a certificate for
any name your devices will then trust. It is in `.gitignore` (`*/data/`).

Immich's mobile app may not trust a user-installed CA (Android apps ignore them by
default); keep the app on `https://liorgadol.ddnsfree.com:2284`.

To add a service: add a `http://<name>.gadol.lan { reverse_proxy 192.168.1.200:<port> }`
block to `caddy/Caddyfile`, then `docker compose restart caddy`. No DNS change needed.

Non-HTTP ports: Caddy on 80 and 443, Pi-hole DNS on 53/tcp+udp, WireGuard on 51820/udp, go2rtc RTSP on 8554 and WebRTC on 8555/tcp+udp, Emby HTTPS on 8920.

## Port Conflicts

If you encounter port conflicts, modify the ports in `docker-compose.yml`:

```yaml
ports:
  - "NEW_PORT:CONTAINER_PORT"
```

For example, to change Dozzle from port 8080 to 8085:
```yaml
ports:
  - "8085:8080"
```

## Backup

Important directories to backup:
- `./filebrowser/` - FileBrowser data and configuration
- `./homarr/appdata/` - Homarr boards, apps and integrations
- `./pihole/` - Pi-hole configuration and blocklists
- `./pinchflat/config/` - Pinchflat subscriptions
- `./stirlingtools/configs/` - Stirling PDF settings
- `./dockhand/data/` - Dockhand configuration
- `./dozzle/data/` - Dozzle users and settings
- `./beszel/data/` - Beszel hub database (systems, metric history, alerts)
- `./beszel-agent/data/` - Beszel agent state
- `./caddy/data/` - Caddy's local CA for `immich.gadol.lan`. Losing it means installing a new root certificate on every device. Contains the CA private key: keep the backup private
- `./caddy-ui/data/` - caddy/ui settings and Caddyfile history
- `./wgeasy/config/` - WireGuard peer configs and keys
- `./wud/data/` - WUD state
- `./splitcam/config/` - go2rtc stream definitions
- `./emby/config/` - Emby settings, library definitions and metadata
- `./uptime-kuma/data/` - Uptime Kuma database (monitor history, admin account)
- `./autokuma/data/` - AutoKuma's map of label ids to Uptime Kuma ids; back it up together with `./uptime-kuma/data/`

### Stack backup script (Restic)

`scripts/homelab-backup.sh` backs up the whole stack folder (no excludes) plus `/etc/LinuxExecBot` into a
Restic repository on the SMB share:

1. `docker compose down` (every service, so the SQLite databases are consistent)
2. `restic backup`
3. `docker compose up -d --wait`, then restarts `autokuma` (fresh Uptime Kuma session)
4. `restic forget --prune` with the retention policy, after the stack is back up
5. `restic check --read-data-subset=10%` on Sundays
6. Pings an Uptime Kuma push monitor

Once the stack is down, every exit path (failure, Ctrl-C, dropped SSH session) brings it back up.
Telegram messages are sent only on failure, or when the stack does not come back healthy (with the
list of services that are not). Success is silent; the push monitor catches runs that never happen.
DNS is down while the stack is down (Pi-hole), so mount the share and point `KUMA_PUSH_URL` at IPs, not hostnames.

One-time setup on the host (as root):

```bash
apt install restic && restic self-update
openssl rand -base64 32 > /root/.restic-pass && chmod 600 /root/.restic-pass   # keep a copy off the host
mountpoint /mnt/homelab_backup
GODEBUG=asyncpreemptoff=1 restic -r /mnt/homelab_backup/restic -p /root/.restic-pass init
```

In Uptime Kuma add a **Push** monitor with a heartbeat interval of 90000s (25h) and put its URL in `.env`
as `KUMA_PUSH_URL`. Run the first backup by hand inside `tmux`: it copies everything, so it has the longest downtime.

```cron
0 4 * * * /opt/docker/homelab/scripts/homelab-backup.sh
```

Defaults (override with environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `STACK_DIR` | `/opt/docker/homelab` | Compose project folder to back up |
| `EXTRA_PATHS` | `/etc/LinuxExecBot` | Space separated host paths backed up alongside it |
| `BACKUP_MOUNT` | `/mnt/homelab_backup` | SMB mountpoint; the run fails if it is not mounted |
| `RESTIC_REPOSITORY` | `$BACKUP_MOUNT/restic` | Restic repository |
| `RESTIC_PASSWORD_FILE` | `/root/.restic-pass` | Repository password. Lose it and the backups are unreadable |
| `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` | `14` / `8` / `12` | Retention |
| `CHECK_DAY` / `CHECK_SUBSET` | `7` (Sunday) / `10%` | When `restic check` runs and how much data it reads |
| `STOP_TIMEOUT` | `60` | Seconds to wait for a clean shutdown |
| `HEALTH_TIMEOUT` | `300` | Seconds to wait for the stack to be running and healthy |
| `ENV_FILE` | `$STACK_DIR/.env` | Where `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `KUMA_PUSH_URL` are read from |
| `LOG` | `/var/log/homelab-backup.log` | Log file (local, so it works when the share is missing) |

Restore examples:

```bash
export RESTIC_REPOSITORY=/mnt/homelab_backup/restic RESTIC_PASSWORD_FILE=/root/.restic-pass
restic snapshots
restic restore latest --target /tmp/restore --include /opt/docker/homelab/uptime-kuma
restic mount /mnt/restic   # browse every snapshot as folders
```

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
1. Configure your router's DHCP to hand out the host (`192.168.1.200`) as the DNS server
2. Remove any secondary DNS server there, or devices bypass Pi-hole

### Deploying over WireGuard
A stack-wide `docker compose up -d` also recreates `wg-easy`. If you are connected through
that VPN, the tunnel drops, your SSH session dies, and the compose client is killed
mid-run. Containers it had already recreated are left in the `Created` state: removed and
replaced, but never started. Nothing shows in the Docker daemon logs. Run deploys inside
`tmux`, or recreate `wg-easy` last:
```bash
docker compose up -d $(docker compose config --services | grep -v '^wg-easy$')
docker compose up -d wg-easy
```
Check for leftovers afterwards; `docker compose up -d` starts them:
```bash
docker compose ps -a --filter status=created
```

### Emby media volumes won't mount
CIFS volumes are mounted by the Docker daemon at container start, so a bad credential or an unreachable Windows Server shows up as a failure to start Emby.
```bash
docker compose logs emby
docker volume inspect homelab_movies
```
Check that `cifs-utils` is installed, `SMB_USER`/`SMB_PASS` are correct, and the share names in `docker-compose.yml` match the Windows Server shares. Removing a volume requires `docker compose down` first, then `docker volume rm`.

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
- Stirling PDF has security disabled - enable if exposing to internet
- Consider placing services behind a VPN if accessing remotely (wg-easy is included for this)
- Several services (Dozzle, Homarr, Dockhand, caddy/ui, WUD, Glances, Beszel agent, Uptime Kuma, AutoKuma) mount `/var/run/docker.sock` - anyone with access to those containers has effective root on the host
- go2rtc's API is configured with `origin: "*"` and no authentication - do not expose port 1984 to the internet
- The Telegram bot token is interpolated into an AutoKuma label, so it shows in `docker inspect autokuma` (it is already visible in `docker inspect wud` as an environment variable)
- Camera and Windows Server share credentials live in `.env` and are interpolated into stream URLs and mount options - keep `.env` out of version control (it is already in `.gitignore`)

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

Removing the labels, or the service, does **not** delete the monitor:
`AUTOKUMA__ON_DELETE=keep` is set. Delete it by hand in the UI when a service is retired.
Other monitor types and settings: <https://autokuma.bigboot.dev/dev/entity-types/overview/>.

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
- **`AUTOKUMA__ON_DELETE=keep` is deliberate.** With the default (`delete`), AutoKuma
  deletes a monitor and its whole history about 60 seconds after its container is
  *removed* (a stopped container is fine). A service left removed by an interrupted
  deploy (see [Deploying over WireGuard](#deploying-over-wireguard)) would then vanish from
  Uptime Kuma instead of alerting, and come back later as a new monitor with no history.
  With `keep`, the monitor goes red, Telegram fires, and the same monitor is reused when
  the container returns.
- **Change label-managed monitors through the labels, not the UI.** AutoKuma writes the
  label values back when it sees a difference, as with the notification above.

## Updates

WUD scans every 2 hours, sends one Telegram message per newly detected version, then pulls the new image and recreates the container.

Two per-container opt-outs, set as Docker labels:

**Monitor only** — still scanned, still notified, never updated:

```yaml
labels:
  - "wud.trigger.exclude=docker.local"
```

`docker.local` is the auto-update trigger's id (`{type}.{name}`); the `telegram.bot` trigger still applies. WUD itself and Immich use this.

**Ignore completely** — not scanned, not notified, not updated:

```yaml
labels:
  - "wud.watch=false"
```

Five containers carry this label (the `immich_*` ones in Immich's own compose file at `/opt/docker/immich`):

| container | reason |
|---|---|
| `cutter_backend`, `cutter_frontend` | built locally, no registry to check |
| `immich_nginx_proxy` | plain `nginx:alpine` |
| `immich_redis` | pinned `valkey:9@sha256:...`; Immich bumps it with its own releases |
| `immich_postgres` | pinned `postgres:14-...@sha256:...`; a major bump will not start against an older data directory |

A `@sha256:` reference is immutable, but WUD reads the *tag* and would find `valkey:10`
or `postgres:15` as candidates, so the label is needed even on pinned images.

### Testing Telegram

The Telegram trigger can be fired by hand against a made-up container, which exercises the
real credentials without waiting for an update:

```bash
P=$(grep '^WUD_AUTH_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "gadol:$P" \
  -X POST http://localhost:3033/api/triggers/telegram/bot \
  -H 'Content-Type: application/json' \
  -d '{"name":"telegram-test","watcher":"local","updateKind":{"kind":"tag","localValue":"1.0.0","remoteValue":"1.0.1","semverDiff":"patch"},"result":{}}'
```

A message on the phone plus `Trigger executed with success` in `docker logs wud` means it
works. If the trigger fails with `chat not found`, the bot was never started from that chat.
This bypasses the `once` bookkeeping, so it does not disturb real notification state.

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
- [Caddy](https://github.com/caddyserver/caddy)
- [caddy/ui](https://github.com/zackwag/caddy-ui)
- [Dozzle](https://github.com/amir20/dozzle)
- [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser)
- [Homarr](https://github.com/homarr-labs/homarr)
- [Pi-hole](https://github.com/pi-hole/pi-hole)
- [Pinchflat](https://github.com/kieraneglin/pinchflat)
- [Dockhand](https://github.com/fnsys/dockhand)
- [Stirling PDF](https://github.com/Stirling-Tools/Stirling-PDF)
- [WUD](https://github.com/getwud/wud)
- [wg-easy](https://github.com/wg-easy/wg-easy)
- [go2rtc](https://github.com/AlexxIT/go2rtc)
- [Emby](https://emby.media)
- [Glances](https://github.com/nicolargo/glances)
- [Beszel](https://github.com/henrygd/beszel)
- [Uptime Kuma](https://github.com/louislam/uptime-kuma)
- [AutoKuma](https://github.com/BigBoot/AutoKuma)
