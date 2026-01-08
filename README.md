# Docker Compose Stack

A comprehensive Docker Compose stack featuring essential services for home server management, monitoring, and utilities.

## Services Overview

### 🔍 Dozzle
**Port:** 8080  
Real-time Docker container log viewer with a clean web interface.
- Access at: `http://localhost:8080`

### 📁 FileBrowser
**Port:** 8081  
Web-based file manager for browsing and managing files.
- Access at: `http://localhost:8081`
- Files served from: `./filebrowser/data`

### 🏠 Homepage
**Port:** 3000  
Customizable dashboard for organizing your services and links.
- Access at: `http://localhost:3000`
- Configuration: `./homepage/config`

### 🛡️ Pi-hole
**Ports:** 53 (DNS), 80 (HTTP), 443 (HTTPS)  
Network-wide ad blocker and DNS server.
- Web interface: `http://localhost:80/admin`
- Blocks ads and tracking at the DNS level

### 📺 Pinchflat
**Port:** 8945  
YouTube downloader and subscription manager.
- Access at: `http://localhost:8945`
- Downloads saved to: `./pinchflat/downloads`

### 🐳 Portainer
**Port:** 9443  
Docker container management UI with advanced features.
- Access at: `https://localhost:9443`

### 📄 Stirling PDF
**Port:** 8090  
Self-hosted PDF manipulation tools (merge, split, convert, etc.).
- Access at: `http://localhost:8090`
- Security disabled for local use

### 🔄 Watchtower
Automatically updates running Docker containers.
- Checks for updates every 30 minutes (1800 seconds)
- Automatically cleans up old images

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2.0+

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
```

### Required Variables:
- `PIHOLE_TZ`: Your timezone (e.g., America/New_York, Europe/London)
- `PIHOLE_WEBPASSWORD`: Password for Pi-hole admin interface
- `PIHOLE_SERVERIP`: Your server's IP address

### Optional Variables:
- `HOMEPAGE_ALLOWED_HOSTS`: Allowed hostnames for Homepage (leave empty for all)
- `FILEBROWSER_USERNAME`: FileBrowser username (default: admin)
- `FILEBROWSER_PASSWORD`: FileBrowser password

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
├── filebrowser/
│   ├── config/
│   ├── data/
│   └── database/
├── homepage/
│   └── config/
├── pihole/
│   ├── etc-pihole/
│   └── etc-dnsmasq.d/
├── pinchflat/
│   ├── config/
│   └── downloads/
└── stirlingtools/
    ├── configs/
    └── customFiles/
```

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
Watchtower handles this automatically, but you can also manually update:
```bash
docker compose pull
docker compose up -d
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
| Portainer | https://localhost:9443 | Docker management |
| Stirling PDF | http://localhost:8090 | PDF tools |

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

## Security Considerations

- Change all default passwords immediately
- Pi-hole runs on standard HTTP/HTTPS ports (80/443) - consider using a reverse proxy
- Stirling PDF has security disabled - enable if exposing to internet
- Consider placing services behind a VPN if accessing remotely
- Portainer uses HTTPS on port 9443 - you'll get a certificate warning on first access

## Updates

Watchtower automatically checks for and applies updates every 30 minutes. To disable automatic updates for a specific service, add this label:

```yaml
labels:
  - "com.centurylinklabs.watchtower.enable=false"
```

## License

This stack uses various open-source projects. Please refer to each project's license:
- [Dozzle](https://github.com/amir20/dozzle)
- [FileBrowser](https://github.com/filebrowser/filebrowser)
- [Homepage](https://github.com/gethomepage/homepage)
- [Pi-hole](https://github.com/pi-hole/pi-hole)
- [Pinchflat](https://github.com/kieraneglin/pinchflat)
- [Portainer](https://github.com/portainer/portainer)
- [Stirling PDF](https://github.com/Stirling-Tools/Stirling-PDF)
- [Watchtower](https://github.com/containrrr/watchtower)