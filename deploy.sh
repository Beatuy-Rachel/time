#!/usr/bin/env bash

set -Eeuo pipefail

IMAGE="${IMAGE:-ghcr.io/beatuy-rachel/time}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-time-record}"
HOST_PORT="${HOST_PORT:-8080}"
CONTAINER_PORT="${CONTAINER_PORT:-80}"

log() {
  printf '[time-record] %s\n' "$*"
}

fail() {
  printf '[time-record] 错误：%s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail '未找到 Docker，请先安装 Docker。'
docker info >/dev/null 2>&1 || fail 'Docker 服务不可用，请确认当前用户有权限使用 Docker。'

if [[ -n "${GHCR_TOKEN:-}" || -n "${GHCR_USERNAME:-}" ]]; then
  [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USERNAME:-}" ]] || \
    fail 'GHCR_TOKEN 和 GHCR_USERNAME 必须同时设置。'
  log '登录 GitHub Container Registry...'
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin >/dev/null
fi

FULL_IMAGE="${IMAGE}:${IMAGE_TAG}"
log "拉取镜像 ${FULL_IMAGE}..."
docker pull "$FULL_IMAGE"

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  log "停止并删除旧容器 ${CONTAINER_NAME}..."
  docker rm --force "$CONTAINER_NAME" >/dev/null
fi

log "启动服务 ${CONTAINER_NAME}（端口 ${HOST_PORT}:${CONTAINER_PORT}）..."
docker run --detach \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --publish "${HOST_PORT}:${CONTAINER_PORT}" \
  "$FULL_IMAGE" >/dev/null

if ! docker ps --filter "name=^/${CONTAINER_NAME}$" --filter status=running --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker logs "$CONTAINER_NAME" >&2 || true
  fail '容器启动失败。'
fi

log "部署完成：http://<服务器IP>:${HOST_PORT}"
