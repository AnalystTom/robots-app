#!/usr/bin/env bash
set -euo pipefail

files="$(git diff --no-renames --name-only HEAD^1 HEAD)"
web=false
e2e=false
server=false
native=false
compose=false
all_packages=false
while IFS= read -r file; do
  case "$file" in
    */Dockerfile*) all_packages=true ;;
    apps/*/package.json | packages/*/package.json | infra/*/package.json) all_packages=true ;;
    # vitest.config.ts loads these into every package's tests, which the package graph misses.
    packages/testkit/src/pin-test-env.ts | packages/testkit/src/lingui-core-macro.ts | \
      packages/testkit/src/lingui-react-macro.ts | \
      packages/chat-ui/src/native-test-stubs.tsx) all_packages=true ;;
    apps/*/* | packages/*/* | infra/sandboxes/supervisor/* | infra/updater/*) ;;
    .agents/skills/pr-watch/* | .agents/skills/translate/*) all_packages=true ;;
    .agents/* | .claude/* | docs/*) ;;
    */*) all_packages=true ;;
    *.md) ;;
    *) all_packages=true ;;
  esac
  case "$file" in
    .github/workflows/ci.yml | .github/workflows/playwright.yml | .github/actions/setup-workspace/* | .github/actions/setup-pnpm/* | .github/scripts/changed-areas.sh | .github/scripts/start-postgres.sh | pnpm-lock.yaml | package.json)
      native=true
      compose=true
      ;;
    apps/desktop/* | scripts/pnpm*.mjs | scripts/setup-worktree*.mjs | \
      packages/adapter-kit/* | packages/core/src/node/* | \
      packages/adapters/src/*computer* | packages/adapters/src/*desktop* | \
      packages/adapters/src/*sandbox* | packages/adapters/src/*host-* | \
      packages/adapters/src/home* | packages/adapters/src/native-shell* | \
      packages/adapters/src/page-browser* | packages/adapters/src/file-handle-path* | \
      packages/adapters/src/workspace-save-*)
      native=true
      ;;
    infra/compose/*) compose=true ;;
  esac
  case "$file" in
    apps/*/package.json | packages/*/package.json) ;;
    .agents/* | .claude/* | apps/mobile/*) continue ;;
    docs/*) web=true; continue ;;
    apps/web/* | apps/desktop/* | packages/ui-web/* | packages/chat-ui/*)
      web=true
      e2e=true
      continue
      ;;
    apps/worker/*) web=true; server=true; continue ;;
    packages/adapters/*) web=true; e2e=true; server=true; continue ;;
    */*) ;;
    *.md) continue ;;
  esac
  web=true
  e2e=true
  server=true
done <<<"$files"
echo "web=$web"
echo "e2e=$e2e"
echo "server=$server"
echo "native=$native"
echo "compose=$compose"
echo "all_packages=$all_packages"
