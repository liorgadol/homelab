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
- Basic auth: user `admin`, password from `WUD_AUTH_ADMIN_PASSWORD`
- State stored in: `./wud/data`
- Scans every 2 hours (`WUD_WATCHER_LOCAL_CRON=0 */2 * * *`)
- Watches digests as well as tags (`WATCHDIGESTDEFAULT=true`), required to detect updates on `:latest`
- Pulls and recreates containers automatically, pruning the old images
- Excluded from its own auto-update trigger (`wud.trigger.exclude=docker.local`): WUD 9.0.2 has no self-update guard and would stop its own container mid-swap. Bump it manually with `docker compose pull wud && docker compose up -d wud`
- Sends one email per detected update (SMTP, Gmail)
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
```

### Required Variables:
- `PIHOLE_TZ`: Your timezone (e.g., America/New_York, Europe/London)
- `PIHOLE_WEBPASSWORD`: Password for Pi-hole admin interface
- `PIHOLE_SERVERIP`: Your server's IP address
- `WIREGUARD_PASS_HASH`: bcrypt hash for wg-easy web UI password
- `WUD_AUTH_ADMIN_PASSWORD`: Password for the WUD web UI
- `CAMERA_USER`, `CAMERA_PASSWORD`, `CAMERA1_IP`, `CAMERA2_IP`: RTSP credentials and addresses for go2rtc
- `SMB_USER`, `SMB_PASS`: Credentials for the CIFS shares backing the Emby libraries

### Optional Variables:
- `HOMEPAGE_ALLOWED_HOSTS`: Allowed hostnames for Homepage (leave empty for all)
- `FILEBROWSER_USERNAME`: FileBrowser username (default: admin)
- `FILEBROWSER_PASSWORD`: FileBrowser password
- `GHCR_USERNAME`, `GHCR_TOKEN`: GitHub username and a PAT with `read:packages` scope, used by WUD to avoid ghcr rate limiting
- `WUD_EMAIL_USER`, `WUD_EMAIL_PASSWORD`, `WUD_EMAIL_FROM`, `WUD_EMAIL_TO`: SMTP notification settings for WUD (Gmail). These are read by Docker Compose on the host and substituted into the `WUD_TRIGGER_SMTP_GMAIL_*` variables; WUD itself never sees them under these names.

Note: several containers (WUD, wg-easy, Emby) have `TZ=Asia/Jerusalem` hardcoded in `docker-compose.yml`. Pinchflat reuses `PIHOLE_TZ`.

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

### Emby config backup script

`scripts/emby-backup.sh` stops Emby, tars the whole config tree, verifies the archive, restarts the container and prunes old archives.

```bash
sudo ./scripts/emby-backup.sh
```

Defaults (override with environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONFIG_DIR` | `/opt/docker/homelab/emby/config` | Emby config tree to archive |
| `BACKUP_DIR` | `/mnt/emby_backup` | Where archives and `emby-backup.log` are written |
| `CONTAINER` | `emby` | Container to stop/start |
| `KEEP` | `3` | Number of archives to retain |
| `STOP_TIMEOUT` | `60` | Seconds to wait for a clean shutdown |

Must run as root. Example cron entry (daily at 04:00):

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
- Several services (Dozzle, Homepage, Dockhand, WUD, Glances) mount `/var/run/docker.sock` - anyone with access to those containers has effective root on the host
- go2rtc's API is configured with `origin: "*"` and no authentication - do not expose port 1984 to the internet
- Camera and NAS credentials live in `.env` and are interpolated into stream URLs and mount options - keep `.env` out of version control (it is already in `.gitignore`)

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

The Cutter services carry this one because they are built locally and have no registry to check.

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
