#!/usr/bin/env bash
set -euo pipefail
cd /app
trap 'kill $(jobs -pr) 2>/dev/null || true; wait || true' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
node apps/api/dist/registration-preview/hosted-test.js &
api_pid=$!
node --input-type=module -e '
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await fetch("http://127.0.0.1:3100/ready", {signal:AbortSignal.timeout(1000)}).then(r=>r.ok).catch(()=>false)) process.exit(0);
    try { process.kill(Number(process.argv[1]), 0); } catch { process.exit(1); }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  process.exit(1);
' "$api_pid"
(cd apps/worker && exec env -u STRIPE_SECRET_KEY -u STRIPE_WEBHOOK_SECRET node dist/index.js) &
(cd apps/web && exec env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production ROBOTS_HOST="$ROBOTS_HOST" SCREEN_PROXY_SECRET="$SCREEN_PROXY_SECRET" API_PROXY_TARGET=http://127.0.0.1:3100 node_modules/.bin/vite preview --host 0.0.0.0 --port 5173) &
wait -n
exit 1
