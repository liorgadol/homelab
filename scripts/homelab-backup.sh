#!/usr/bin/env bash
#
# Whole-stack backup with Restic.
# Takes the compose stack down, backs up the stack folder (plus EXTRA_PATHS)
# into a Restic repository, brings the stack back up and waits for it to be
# healthy. Then applies the retention policy, runs a weekly repository check
# and pings an Uptime Kuma push monitor.
# Sends a Telegram message if anything fails or the stack does not come back healthy.
#
# Usage:  sudo ./homelab-backup.sh
# Cron:   set it up yourself, e.g. 0 4 * * * /opt/docker/homelab/scripts/homelab-backup.sh
#
set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/docker/homelab}"
EXTRA_PATHS="${EXTRA_PATHS:-/etc/LinuxExecBot}"     # space separated, backed up alongside STACK_DIR
BACKUP_MOUNT="${BACKUP_MOUNT:-/mnt/homelab_backup}"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-${BACKUP_MOUNT}/restic}"
export RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/root/.restic-pass}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
CHECK_DAY="${CHECK_DAY:-7}"                 # day of week for restic check (1=Mon .. 7=Sun)
CHECK_SUBSET="${CHECK_SUBSET:-10%}"         # share of pack data read and verified by the check
STOP_TIMEOUT="${STOP_TIMEOUT:-60}"          # seconds docker waits for a clean shutdown
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"     # seconds to wait for the stack to be running/healthy
BACKUP_TIMEOUT="${BACKUP_TIMEOUT:-7200}"    # seconds before a stuck restic backup (e.g. hung share) is killed
PREFLIGHT_TIMEOUT="${PREFLIGHT_TIMEOUT:-30}" # seconds for the share/repository checks
ENV_FILE="${ENV_FILE:-${STACK_DIR}/.env}"   # source of the Telegram credentials and Kuma push URL
LOG="${LOG:-/var/log/homelab-backup.log}"
LOCK_FILE="${LOCK_FILE:-/run/homelab-backup.lock}"

# Restic is Go: on CIFS mounts, Go's async preemption signals can surface as
# "interrupted system call" errors on older kernels. Turning it off is harmless.
export GODEBUG=asyncpreemptoff=1

COMPOSE=(docker compose --project-directory "$STACK_DIR" -f "${STACK_DIR}/docker-compose.yml")

# Never fails: tee errors (dropped terminal, full disk) must not abort the
# script under set -e - least of all inside the exit trap that restarts the stack.
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG" || true; }
die() { FAIL_MSG="$*"; log "ERROR: $*"; exit 1; }

touch "$LOG" 2>/dev/null || { echo "cannot write log file: $LOG (run as root)" >&2; exit 1; }

# --- telegram / kuma ---------------------------------------------------------
# cron does not load the compose .env, so read the values from it directly
# (grep, not source: the file is compose syntax, not shell). Environment wins.
env_get() {
    [ -r "$ENV_FILE" ] || return 0
    grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' \
        | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true
}
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-$(env_get TELEGRAM_BOT_TOKEN)}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-$(env_get TELEGRAM_CHAT_ID)}"
KUMA_PUSH_URL="${KUMA_PUSH_URL:-$(env_get KUMA_PUSH_URL)}"

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
# One trap for every exit path. Once the stack is down, any exit - failure,
# Ctrl-C, timeout - brings it back up before the script ends.
STACK_DOWN=0
FAIL_MSG=""

# Services that are not running, or have a healthcheck that is not healthy,
# with their state, e.g. "emby(running/starting),pihole(exited)".
unhealthy_services() {
    "${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null \
        | awk '$2 != "running" || ($3 != "" && $3 != "healthy") {print $1 "(" $2 ($3 != "" ? "/" $3 : "") ")"}' \
        | paste -sd, - || true
}

start_stack() {
    STACK_DOWN=0
    log "starting stack (waiting up to ${HEALTH_TIMEOUT}s for healthy)"
    if "${COMPOSE[@]}" up -d --wait --wait-timeout "$HEALTH_TIMEOUT" >>"$LOG" 2>&1; then
        log "stack is up and healthy"
    else
        bad="$(unhealthy_services)"
        log "ERROR: stack did not come back healthy: ${bad:-see log}"
        notify "⚠️ Homelab backup on $(hostname): stack did not come back healthy after the backup. Not healthy: ${bad:-unknown}. Log: $LOG"
    fi
    # A fresh uptime-kuma leaves AutoKuma with a stale session until it restarts.
    "${COMPOSE[@]}" restart autokuma >>"$LOG" 2>&1 || log "WARN: failed to restart autokuma"
}

on_exit() {
    rc=$?
    # Recovery must run to the end: no set -e, and no second Ctrl-C/TERM
    # cutting it short after compose up returns.
    set +e
    trap '' HUP INT TERM
    if [ "$STACK_DOWN" -eq 1 ]; then
        start_stack
    fi
    if [ "$rc" -ne 0 ]; then
        notify "❌ Homelab backup failed on $(hostname): ${FAIL_MSG:-exit code $rc}. Log: $LOG"
    fi
    exit "$rc"
}
trap on_exit EXIT
# Ignore hangups: down stops wg-easy, which drops an SSH session that comes in
# over the VPN. The ignore is inherited by restic and docker, so the run finishes.
trap '' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# --- preflight ---------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "must run as root (stack files are owned by several users, password file is root-only)"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another homelab-backup is already running"
command -v docker >/dev/null || die "docker not found in PATH"
command -v restic >/dev/null || die "restic not found in PATH"
[ -f "${STACK_DIR}/docker-compose.yml" ] || die "compose file not found: ${STACK_DIR}/docker-compose.yml"
for p in $EXTRA_PATHS; do
    [ -e "$p" ] || die "extra path not found: $p"
done
# Hard fail: without the share, restic would write to the root filesystem.
timeout "$PREFLIGHT_TIMEOUT" mountpoint -q "$BACKUP_MOUNT" \
    || die "backup share not mounted or not responding: $BACKUP_MOUNT"
[ -r "$RESTIC_PASSWORD_FILE" ] || die "restic password file not readable: $RESTIC_PASSWORD_FILE"
timeout "$PREFLIGHT_TIMEOUT" restic cat config >/dev/null 2>>"$LOG" \
    || die "restic repository not reachable or wrong password: $RESTIC_REPOSITORY (run restic init once)"

log "=== homelab backup start"

# --- stop stack --------------------------------------------------------------
# Set before down: a down that fails halfway still needs the stack brought back.
STACK_DOWN=1
DOWN_AT="$(date +%s)"
log "stopping stack (timeout ${STOP_TIMEOUT}s)"
"${COMPOSE[@]}" down -t "$STOP_TIMEOUT" >>"$LOG" 2>&1 || die "docker compose down failed"

# --- backup ------------------------------------------------------------------
log "restic backup: $STACK_DIR $EXTRA_PATHS -> $RESTIC_REPOSITORY"
# A hung share must not keep the stack down forever: timeout kills restic
# (KILL 60s later if TERM is ignored) and the trap brings the stack back.
# shellcheck disable=SC2086  # EXTRA_PATHS is a space separated list
if timeout --foreground -k 60 "$BACKUP_TIMEOUT" \
    restic backup --tag stack "$STACK_DIR" $EXTRA_PATHS >>"$LOG" 2>&1; then
    rc=0
else
    rc=$?
fi
case "$rc" in
    0) log "restic backup done" ;;
    3) die "restic snapshot is incomplete: some files could not be read (see log)" ;;
    124|137) die "restic backup timed out after ${BACKUP_TIMEOUT}s (share hung?)" ;;
    *) die "restic backup failed (exit code $rc)" ;;
esac

# --- start stack -------------------------------------------------------------
start_stack
log "downtime: $(( $(date +%s) - DOWN_AT ))s"

# --- retention ---------------------------------------------------------------
# After the stack is up: prune is slow on SMB and does not need the stack down.
log "restic forget/prune (daily $KEEP_DAILY, weekly $KEEP_WEEKLY, monthly $KEEP_MONTHLY)"
restic forget --tag stack --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" \
    --keep-monthly "$KEEP_MONTHLY" --prune >>"$LOG" 2>&1 \
    || die "restic forget/prune failed"

# --- check -------------------------------------------------------------------
if [ "$(date +%u)" = "$CHECK_DAY" ]; then
    log "restic check (reading $CHECK_SUBSET of the data)"
    restic check --read-data-subset="$CHECK_SUBSET" >>"$LOG" 2>&1 \
        || die "restic check found problems in $RESTIC_REPOSITORY"
fi

# --- heartbeat ---------------------------------------------------------------
# Uptime Kuma push monitor: alerts when no successful run checks in.
if [ -n "$KUMA_PUSH_URL" ]; then
    curl -fsS --max-time 10 -o /dev/null "$KUMA_PUSH_URL" || log "WARN: uptime kuma push failed"
else
    log "WARN: KUMA_PUSH_URL not set - skipping heartbeat"
fi

log "=== homelab backup complete"
