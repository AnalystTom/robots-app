#!/usr/bin/env bash
set -euo pipefail
: "${STAGING_OWNER_EMAIL:?Set the exact owner email}"
[[ "$STAGING_OWNER_EMAIL" =~ ^[^@*,[:space:]]+@[^@*,[:space:]]+\.[^@*,[:space:]]+$ ]] || exit 2
: "${STAGING_IMAGE:?Set the locally built RoBots image}"
root=$(cd -- "$(dirname -- "$0")" && pwd)
identity="${XDG_CONFIG_HOME:-$HOME/.config}/infisical/machine-identities.json"
export INFISICAL_DOMAIN=http://127.0.0.1:8080/api
export INFISICAL_UNIVERSAL_AUTH_CLIENT_ID INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET INFISICAL_TOKEN
INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=$(jq -r .robots.clientId "$identity")
INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=$(jq -r .robots.clientSecret "$identity")
INFISICAL_TOKEN=$(infisical login --method=universal-auth --plain --silent)
project=$(jq -r .robots.projectId "$identity")
read_setting() {
  infisical secrets get "ROBOTS_HOSTED_TEST_$1" --env=prod --path=/robots --projectId="$project" --plain --silent
}
export STAGING_DB_ADMIN STAGING_DB_RUNTIME STAGING_ENCRYPTION STAGING_SESSION STAGING_SCREEN
STAGING_DB_ADMIN=$(read_setting DB_ADMIN_PASSWORD)
STAGING_DB_RUNTIME=$(read_setting DB_RUNTIME_PASSWORD)
STAGING_ENCRYPTION=$(read_setting ENCRYPTION_KEY)
STAGING_SESSION=$(read_setting SESSION_SECRET)
STAGING_SCREEN=$(read_setting SCREEN_PROXY_SECRET)
unset INFISICAL_TOKEN INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET INFISICAL_UNIVERSAL_AUTH_CLIENT_ID
docker compose -f "$root/compose.yml" up --pull never -d --wait --wait-timeout 300
