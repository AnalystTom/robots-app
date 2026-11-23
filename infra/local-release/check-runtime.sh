#!/usr/bin/env bash
set -euo pipefail
docker run --rm --network none --entrypoint sh "${1:?Supply the release image}" -ec '
cd /app
for file in apps/api/dist/index.js apps/worker/dist/index.js apps/web/dist/index.html apps/web/dist-server/index.js packages/page-kit/runtime.js infra/sandboxes/supervisor/dist/index.js LICENSE NOTICE; do
  test -s "$file"
done
test -z "$(find . -type d -name node_modules -prune -o \( -name .git -o -name src -o -name "*.tsx" -o -name "*.ts" -o -name ".env" -o -name "*.pem" -o -name "*.key" \) -print -quit)"
test -z "$(find . -name "*.map" -print -quit)"
test ! -e /app/scripts
test ! -e /app/.github
test ! -e /app/infra/registration
'
