#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
arch="$(docker info --format '{{.OSType}}/{{.Architecture}}')"
case "$arch" in
  linux/x86_64|linux/amd64) ;;
  *) echo "This RoBots installer requires Linux x86-64 Docker Engine." >&2; exit 1 ;;
esac
docker load -i images.tar
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-robots-personal}"
export ROBOTS_WEB_PORT="${ROBOTS_WEB_PORT:-5193}" ROBOTS_API_PORT="${ROBOTS_API_PORT:-3193}"
export ROBOTS_WEB_BIND=127.0.0.1
export WEB_ORIGIN="http://127.0.0.1:$ROBOTS_WEB_PORT"
export BETTER_AUTH_URL="$WEB_ORIGIN" API_URL="$WEB_ORIGIN"
bash install-images.sh --offline
echo "Create your free local account at $WEB_ORIGIN/sign-up"
