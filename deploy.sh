#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCK_DIR=${DEPLOY_LOCK_DIR:-/tmp/time-record-deploy.lock}
WAIT_TIMEOUT=${DEPLOY_WAIT_TIMEOUT:-120}

if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$SCRIPT_DIR/.env"
    set +a
fi

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
    log "ERROR: $*" >&2
    exit 1
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    log 'Another deployment is already running; exiting.'
    exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT HUP INT TERM

cd "$SCRIPT_DIR"

[ -f compose.yaml ] || fail "compose.yaml not found in $SCRIPT_DIR"
command -v docker >/dev/null 2>&1 || fail 'docker command not found'
docker info >/dev/null 2>&1 || fail 'Docker service is not available'
[ -n "${AUTH_SECRET:-}" ] || fail 'AUTH_SECRET must be set in .env'
[ -n "${POSTGRES_PASSWORD:-}" ] || fail 'POSTGRES_PASSWORD must be set in .env'

if [ -n "${GHCR_TOKEN:-}" ] || [ -n "${GHCR_USERNAME:-}" ]; then
    [ -n "${GHCR_TOKEN:-}" ] && [ -n "${GHCR_USERNAME:-}" ] || \
        fail 'GHCR_TOKEN and GHCR_USERNAME must be set together'
    log 'Logging in to GitHub Container Registry'
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io \
        --username "$GHCR_USERNAME" --password-stdin >/dev/null
fi

docker compose config --quiet

wait_for_healthy() {
    service=$1
    deadline=$(($(date +%s) + WAIT_TIMEOUT))

    while :; do
        container_id=$(docker compose ps --all --quiet "$service" 2>/dev/null || true)
        if [ -n "$container_id" ]; then
            health=$(docker inspect \
                --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
                "$container_id" 2>/dev/null || true)

            case "$health" in
                healthy)
                    log "$service is healthy"
                    return 0
                    ;;
                unhealthy|dead|exited)
                    docker compose logs "$service" >&2 || true
                    fail "$service is $health"
                    ;;
            esac
        fi

        if [ "$(date +%s)" -ge "$deadline" ]; then
            docker compose logs "$service" >&2 || true
            fail "timed out waiting for $service to become healthy"
        fi
        sleep 3
    done
}

log 'Pulling the latest images'
docker compose pull app db

log 'Updating the app and PostgreSQL'
docker compose up -d --pull never --remove-orphans
wait_for_healthy db
wait_for_healthy app

log 'Deployment completed'
docker compose ps
