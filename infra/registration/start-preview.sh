#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "$0")/../.."
state="${XDG_DATA_HOME:-$HOME/.local/share}/robots-registration"
mkdir -p -- "$state"
export PREVIEW_ARCHIVE="$state/robots-local-linux-amd64.tar.gz"
[[ -f "$PREVIEW_ARCHIVE" ]] || bash infra/registration/package-local.sh "$PREVIEW_ARCHIVE"
case "${1:-simulator}" in
  stripe-test)
    export COMPOSE_PROJECT_NAME=robots-registration-stripe
    export PREVIEW_DATABASE=registration_stripe PREVIEW_BILLING_MODE=stripe-test PREVIEW_PORT=5195
    export PREVIEW_STRIPE_KEY="${ROBOTS_STRIPE_TEST_SECRET_KEY:?Missing sandbox API key}"
    export PREVIEW_STRIPE_WEBHOOK="${ROBOTS_STRIPE_TEST_WEBHOOK_SECRET:?Missing sandbox webhook signing secret}"
    export PREVIEW_STRIPE_PRICE="${ROBOTS_STRIPE_TEST_PRICE_ID:?Missing workspace price ID}"
    [[ "$PREVIEW_STRIPE_KEY" == sk_test_* || "$PREVIEW_STRIPE_KEY" == rk_test_* ]] || { echo 'A Stripe test key is required.' >&2; exit 1; }
    ;;
  simulator)
    export COMPOSE_PROJECT_NAME=robots-registration-preview
    export PREVIEW_DATABASE=registration_preview PREVIEW_BILLING_MODE=private-test PREVIEW_PORT=5194
    unset PREVIEW_STRIPE_KEY PREVIEW_STRIPE_WEBHOOK PREVIEW_STRIPE_PRICE
    ;;
  *) echo 'Choose simulator or stripe-test.' >&2; exit 2 ;;
esac
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
echo "Open http://localhost:$PREVIEW_PORT/api/registration"
