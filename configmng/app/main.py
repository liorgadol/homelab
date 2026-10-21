"""configmng - edit an allowlisted set of host config files from a web UI.

Files are declared only through environment variables (see README):
    CONFIG_<name>=/path/inside/container
    RESTART_<name>=shell command run on the host after save (optional)
"""

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import tomllib
from datetime import datetime
from pathlib import Path

import yaml
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

AUTH_USER = os.environ.get("AUTH_USER", "gadol")
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_hex(32)
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP", "20"))
RESTART_TIMEOUT = int(os.environ.get("RESTART_TIMEOUT", "60"))
STATIC_DIR = Path(__file__).parent / "static"

if not AUTH_PASSWORD:
    raise SystemExit("AUTH_PASSWORD is not set - refusing to start without a password")


def load_configs() -> dict[str, dict]:
    configs = {}
    for key, value in os.environ.items():
        if not key.startswith("CONFIG_") or not value:
            continue
        name = key[len("CONFIG_"):]
        configs[name] = {
            "name": name,
            "path": Path(value),
            "restart": os.environ.get(f"RESTART_{name}") or None,
        }
    return dict(sorted(configs.items(), key=lambda kv: kv[0].lower()))


CONFIGS = load_configs()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="strict",
    max_age=60 * 60 * 12,
)


# ---------- helpers ----------

def require_login(request: Request):
    if request.session.get("user") != AUTH_USER:
        raise HTTPException(401, "Not logged in")


def get_config(name: str) -> dict:
    cfg = CONFIGS.get(name)
    if not cfg:
        raise HTTPException(404, "Unknown config")
    return cfg


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {path}")
    except PermissionError:
        raise HTTPException(403, f"No permission to read {path}")


def writable(path: Path) -> bool:
    return os.access(path, os.W_OK)


def backup_dir(name: str) -> Path:
    d = DATA_DIR / "backups" / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def make_backup(name: str, content: str):
    d = backup_dir(name)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    (d / f"{stamp}.bak").write_text(content, encoding="utf-8")
    old = sorted(d.glob("*.bak"))[:-BACKUP_KEEP]
    for f in old:
        f.unlink(missing_ok=True)


def audit(action: str, name: str, detail: str = ""):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now().isoformat(timespec='seconds')}\t{AUTH_USER}\t{action}\t{name}\t{detail}\n"
    with open(DATA_DIR / "audit.log", "a", encoding="utf-8") as f:
        f.write(line)


def validate(path: Path, content: str) -> str | None:
    """Return an error message if the content is not valid for its file type."""
    ext = path.suffix.lower()
    try:
        if ext in (".yaml", ".yml"):
            list(yaml.safe_load_all(content))
        elif ext == ".json":
            json.loads(content)
        elif ext == ".toml":
            tomllib.loads(content)
    except Exception as e:  # noqa: BLE001 - any parser error is a validation error
        return str(e)
    return None


def run_restart(command: str) -> dict:
    # Enter the host's namespaces (needs pid: host + privileged) so systemctl,
    # docker, etc. run exactly as if typed on the host.
    argv = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--", "sh", "-c", command]
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=RESTART_TIMEOUT)
        return {"ok": p.returncode == 0, "code": p.returncode, "output": (p.stdout + p.stderr).strip()}
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": None, "output": f"Timed out after {RESTART_TIMEOUT}s"}
    except FileNotFoundError:
        return {"ok": False, "code": None, "output": "nsenter not available"}


# ---------- auth ----------

class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/login")
async def login(body: LoginBody, request: Request):
    user_ok = hmac.compare_digest(body.username.encode(), AUTH_USER.encode())
    pass_ok = hmac.compare_digest(body.password.encode(), AUTH_PASSWORD.encode())
    if not (user_ok and pass_ok):
        await asyncio.sleep(1.5)  # slow down guessing
        raise HTTPException(401, "Wrong username or password")
    request.session["user"] = AUTH_USER
    return {"user": AUTH_USER}


@app.post("/api/logout")
async def logout(request: Request):
    request.session.clear()
    return {}


@app.get("/api/me")
async def me(request: Request):
    require_login(request)
    return {"user": AUTH_USER}


# ---------- configs ----------

@app.get("/api/configs", dependencies=[Depends(require_login)])
async def list_configs():
    out = []
    for cfg in CONFIGS.values():
        p = cfg["path"]
        exists = p.is_file()
        out.append({
            "name": cfg["name"],
            "path": str(p),
            "exists": exists,
            "writable": exists and writable(p),
            "restartable": bool(cfg["restart"]),
            "modified": p.stat().st_mtime if exists else None,
        })
    return out


@app.get("/api/configs/{name}", dependencies=[Depends(require_login)])
async def get_file(name: str):
    cfg = get_config(name)
    content = read_text(cfg["path"])
    return {
        "name": name,
        "path": str(cfg["path"]),
        "content": content,
        "hash": sha(content),
        "writable": writable(cfg["path"]),
        "restart": cfg["restart"],
    }


class SaveBody(BaseModel):
    content: str
    hash: str
    force: bool = False
    restart: bool = False


@app.put("/api/configs/{name}", dependencies=[Depends(require_login)])
async def save_file(name: str, body: SaveBody):
    cfg = get_config(name)
    path = cfg["path"]
    if not writable(path):
        raise HTTPException(403, "File is read-only")

    current = read_text(path)
    if sha(current) != body.hash:
        raise HTTPException(409, "File changed on disk since you opened it. Reload to see the new version.")
    if current == body.content:
        return {"hash": body.hash, "changed": False, "restart": None}

    if not body.force:
        err = validate(path, body.content)
        if err:
            raise HTTPException(422, err)

    make_backup(name, current)
    # Write in place (same inode) so single-file bind mounts and the file's
    # owner/mode are preserved.
    with open(path, "w", encoding="utf-8") as f:
        f.write(body.content)
    audit("save", name, f"{len(current)}->{len(body.content)} bytes")

    restart = None
    if body.restart and cfg["restart"]:
        restart = await asyncio.to_thread(run_restart, cfg["restart"])
        audit("restart", name, f"ok={restart['ok']}")
    return {"hash": sha(body.content), "changed": True, "restart": restart}


@app.post("/api/configs/{name}/restart", dependencies=[Depends(require_login)])
async def restart(name: str):
    cfg = get_config(name)
    if not cfg["restart"]:
        raise HTTPException(400, "No restart command configured")
    result = await asyncio.to_thread(run_restart, cfg["restart"])
    audit("restart", name, f"ok={result['ok']}")
    return result


class ValidateBody(BaseModel):
    content: str


@app.post("/api/configs/{name}/validate", dependencies=[Depends(require_login)])
async def validate_file(name: str, body: ValidateBody):
    cfg = get_config(name)
    err = validate(cfg["path"], body.content)
    return {"ok": err is None, "error": err}


# ---------- history ----------

@app.get("/api/configs/{name}/history", dependencies=[Depends(require_login)])
async def history(name: str):
    get_config(name)
    files = sorted(backup_dir(name).glob("*.bak"), reverse=True)
    return [{"id": f.stem, "time": f.stat().st_mtime, "size": f.stat().st_size} for f in files]


def backup_file(name: str, backup_id: str) -> Path:
    get_config(name)
    if not backup_id.replace("-", "").isdigit():
        raise HTTPException(400, "Bad backup id")
    f = backup_dir(name) / f"{backup_id}.bak"
    if not f.is_file():
        raise HTTPException(404, "Backup not found")
    return f


@app.get("/api/configs/{name}/history/{backup_id}", dependencies=[Depends(require_login)])
async def get_backup(name: str, backup_id: str):
    return {"content": backup_file(name, backup_id).read_text(encoding="utf-8")}


@app.post("/api/configs/{name}/history/{backup_id}/restore", dependencies=[Depends(require_login)])
async def restore_backup(name: str, backup_id: str):
    cfg = get_config(name)
    path = cfg["path"]
    if not writable(path):
        raise HTTPException(403, "File is read-only")
    content = backup_file(name, backup_id).read_text(encoding="utf-8")
    current = read_text(path)
    make_backup(name, current)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    audit("restore", name, backup_id)
    return {"hash": sha(content)}


@app.get("/api/audit", dependencies=[Depends(require_login)])
async def audit_log():
    f = DATA_DIR / "audit.log"
    if not f.exists():
        return []
    lines = f.read_text(encoding="utf-8").splitlines()[-200:]
    out = []
    for line in reversed(lines):
        parts = line.split("\t")
        if len(parts) >= 4:
            out.append({"time": parts[0], "user": parts[1], "action": parts[2], "name": parts[3],
                        "detail": parts[4] if len(parts) > 4 else ""})
    return out


# ---------- frontend ----------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/{path:path}")
async def spa_fallback(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    return RedirectResponse("/")
