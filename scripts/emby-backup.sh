#!/usr/bin/env bash
#
# Emby config backup.
# Stops the emby container, tars the whole /config tree, starts it back up.
# Keeps the newest $KEEP archives and deletes older ones.
# Sends a Telegram message if the backup fails or Emby does not come back up.
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
ENV_FILE="${ENV_FILE:-/opt/docker/homelab/.env}"   # source of the Telegram credentials

TS="$(date +%Y-%m-%d_%H%M%S)"
ARCHIVE="${BACKUP_DIR}/emby-config-${TS}.tar.gz"
TMP_ARCHIVE="${ARCHIVE}.partial"
LOG="${BACKUP_DIR}/emby-backup.log"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { FAIL_MSG="$*"; log "ERROR: $*"; exit 1; }

# --- telegram ----------------------------------------------------------------
# cron does not load the compose .env, so read the two values from it directly
# (grep, not source: the file is compose syntax, not shell). Environment wins.
env_get() {
    [ -r "$ENV_FILE" ] || return 0
    grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(env_get TELEGRAM_BOT_TOKEN)}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$(env_get TELEGRAM_CHAT_ID)}"

# Best effort: a notification problem is logged, never turned into a failure.
notify() {
    if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
        log "WARN: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set - skipping notification" || true
        return 0
    fi
    curl -fsS --max-time 15 -o /dev/null \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
        --data-urlencode "text=$1" \
        || log "WARN: telegram notification failed" || true
}

# --- exit handling -----------------------------------------------------------
# One trap for every exit path, so a failure anywhere - including preflight and
# commands that trip set -e without going through die - is reported.
WAS_RUNNING=0
FAIL_MSG=""

restart_container() {
    if [ "$WAS_RUNNING" -eq 1 ]; then
        log "starting $CONTAINER"
        if ! docker start "$CONTAINER" >/dev/null; then
            log "ERROR: failed to start $CONTAINER - start it manually"
            notify "⚠️ Emby backup on $(hostname): $CONTAINER did not start again after the backup - start it manually"
        fi
    fi
}

on_exit() {
    rc=$?
    rm -f "$TMP_ARCHIVE"
    restart_container
    if [ "$rc" -ne 0 ]; then
        notify "❌ Emby backup failed on $(hostname): ${FAIL_MSG:-exit code $rc}. Log: $LOG"
    fi
    exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ]; then
    WAS_RUNNING=1
fi

if [ "$WAS_RUNNING" -eq 1 ]; then
    log "stopping $CONTAINER (timeout ${STOP_TIMEOUT}s)"
    docker stop -t "$STOP_TIMEOUT" "$CONTAINER" >/dev/null || die "failed to stop $CONTAINER"
else
    log "WARN: $CONTAINER is not running - backing up as-is"
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
