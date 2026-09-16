# Cutter

Image background removal (rembg) + print bleed tool.

Part of the homelab stack — normally started from the repo root:

```bash
docker compose up -d --build cutter-backend cutter-frontend
```

Open http://localhost:8083

The `docker-compose.yml` in this folder is a standalone fallback for running Cutter on its own machine:

```bash
docker compose up --build -d
```

First build downloads the rembg `u2net` model (~170MB) and bakes it into the image (~3-5 min).

## Layout
- `Dockerfile.backend` — FastAPI + rembg (model prefetched at build)
- `Dockerfile.frontend` — Vite build → nginx, proxies API to `cutter-backend`
- `backend/` — Python source
- `frontend/` — React source

## Change host port
Edit the `cutter-frontend` ports mapping, e.g. `"9090:80"` to serve on 9090.
