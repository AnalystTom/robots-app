#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")/../.."
state="${XDG_DATA_HOME:-$HOME/.local/share}/robots-registration"
mkdir -p -- "$state"
export PREVIEW_ARCHIVE="$state/robots-local-linux-amd64.tar.gz"
[[ -f "$PREVIEW_ARCHIVE" ]] || bash infra/registration/package-local.sh "$PREVIEW_ARCHIVE"
settings="$state/preview.env"
if [[ ! -f "$settings" ]]; then
  setup="$(mktemp "$state/.preview.XXXXXX")"
  trap 'rm -f -- "$setup"' EXIT
  for setting in PREVIEW_DB_PASSWORD PREVIEW_RUNTIME_PASSWORD PREVIEW_ENCRYPTION_KEY PREVIEW_AUTH_SECRET PREVIEW_SCREEN_SECRET; do
    printf '%s=%s\n' "$setting" "$(openssl rand -hex 32)"
  done > "$setup"
  ln "$setup" "$settings" || [[ -f "$settings" ]]
fi
pnpm --filter @robots/db generate
(cd apps/api && node ../../scripts/build-server.mjs src/registration-preview/serve.ts)
docker build --file infra/registration/Dockerfile --tag robots-registration/api-preview:local apps/api/dist/registration-preview
docker compose --env-file "$settings" -f infra/registration/compose.yml up --pull never -d --wait --wait-timeout 600
echo 'Open http://localhost:5194/api/registration'
