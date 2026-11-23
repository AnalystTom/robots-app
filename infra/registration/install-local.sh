#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
docker load -i images.tar
export COMPOSE_PROJECT_NAME=robots-personal
export ROBOTS_IMAGE=robots-registration/app ROBOTS_IMAGE_TAG=local
export ROBOTS_COMPUTER_IMAGE=robots/computer ROBOTS_COMPUTER_IMAGE_TAG=local
export POSTGRES_IMAGE=robots-registration/postgres:16 BUSYBOX_IMAGE=busybox:1
export ROBOTS_WEB_PORT="${ROBOTS_WEB_PORT:-5193}" ROBOTS_API_PORT="${ROBOTS_API_PORT:-3193}"
export ROBOTS_WEB_BIND=127.0.0.1
export WEB_ORIGIN="http://127.0.0.1:${ROBOTS_WEB_PORT}" BETTER_AUTH_URL="http://127.0.0.1:${ROBOTS_WEB_PORT}" API_URL="http://127.0.0.1:${ROBOTS_WEB_PORT}"
bash install-images.sh --offline
echo "Create your local account at ${WEB_ORIGIN}/sign-up"
