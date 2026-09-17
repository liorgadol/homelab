#!/usr/bin/env bash
#
# Emby config backup.
# Stops the emby container, tars the whole /config tree, starts it back up.
# Keeps the newest $KEEP archives and deletes older ones.
#
# Usage:  sudo ./emby-backup.sh
# Cron:   set it up yourself, e.g. 0 4 * * * /opt/docker/homelab/scripts/emby-backup.sh
#
set -euo pipefail

CONFIG_DIR="${CONFIG_DIR:-/opt/docker/homelab/emby/config}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/emby_backup}"
CONTAINER="${CONTAINER:-emby}"
KEEP="${KEEP:-3}"
STOP_TIMEOUT="${STOP_TIMEOUT:-60}"   # seconds docker waits for a clean shutdown

TS="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE="${BACKUP_DIR}/emby-config-${TS}.tar.gz"
TMP_ARCHIVE="${ARCHIVE}.partial"
LOG="${BACKUP_DIR}/emby-backup.log"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "ERROR: $*"; exit 1; }

# --- preflight ---------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "must run as root (config files are owned by uid 1000/root)"
command -v docker >/dev/null || die "docker not found in PATH"
[ -d "$CONFIG_DIR" ] || die "config dir not found: $CONFIG_DIR"
[ -d "$BACKUP_DIR" ] || die "backup dir not found (is it mounted?): $BACKUP_DIR"
mountpoint -q "$BACKUP_DIR" || log "WARN: $BACKUP_DIR is not a mountpoint - backing up to the root filesystem"
touch "$LOG" 2>/dev/null || die "backup dir not writable: $BACKUP_DIR"

# Refuse to start if free space is under the size of the config tree.
NEED_KB="$(du -sk "$CONFIG_DIR" | cut -f1)"
FREE_KB="$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')"
if [ "$FREE_KB" -lt "$NEED_KB" ]; then
    die "not enough free space in $BACKUP_DIR: need ~${NEED_KB}K uncompressed, have ${FREE_KB}K"
fi

# --- stop container ----------------------------------------------------------
WAS_RUNNING=0
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ]; then
    WAS_RUNNING=1
fi

restart_container() {
    if [ "$WAS_RUNNING" -eq 1 ]; then
        log "starting $CONTAINER"
        docker start "$CONTAINER" >/dev/null || log "ERROR: failed to start $CONTAINER - start it manually"
    fi
}

cleanup() {
    rc=$?
    rm -f "$TMP_ARCHIVE"
    restart_container
    exit $rc
}

if [ "$WAS_RUNNING" -eq 1 ]; then
    trap cleanup EXIT INT TERM
    log "stopping $CONTAINER (timeout ${STOP_TIMEOUT}s)"
    docker stop -t "$STOP_TIMEOUT" "$CONTAINER" >/dev/null || die "failed to stop $CONTAINER"
else
    log "WARN: $CONTAINER is not running - backing up as-is"
    trap 'rc=$?; rm -f "$TMP_ARCHIVE"; exit $rc' EXIT INT TERM
fi

# --- archive -----------------------------------------------------------------
log "archiving $CONFIG_DIR -> $ARCHIVE"
tar -czf "$TMP_ARCHIVE" -C "$(dirname "$CONFIG_DIR")" "$(basename "$CONFIG_DIR")"
mv "$TMP_ARCHIVE" "$ARCHIVE"
sync
SIZE="$(du -h "$ARCHIVE" | cut -f1)"
log "archive done: $ARCHIVE ($SIZE)"

# Verify the archive is readable before we prune anything older.
tar -tzf "$ARCHIVE" >/dev/null || die "archive failed verification: $ARCHIVE"
log "archive verified"

# --- prune -------------------------------------------------------------------
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/emby-config-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if [ "${#OLD[@]}" -gt 0 ]; then
    for f in "${OLD[@]}"; do
        log "pruning $f"
        rm -f "$f"
    done
else
    log "nothing to prune (keeping newest $KEEP)"
fi

log "backup complete"
