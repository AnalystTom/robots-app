#!/usr/bin/env bash
set -euo pipefail

VERSION=18.7.0
SHA256=10a1954a80519c634b59a9c452c3a4c5ea24c409fa0a65ba28b76f36157edecc
CACHE_DIR="${POSTGRES_CACHE_DIR:-$(bash "$(dirname "${BASH_SOURCE[0]}")/ci-cache-dir.sh" postgres-binaries)}"
JAR="$CACHE_DIR/embedded-postgres-binaries-linux-amd64-$VERSION.jar"
ROOT="${RUNNER_TEMP:-/tmp}/ci-postgres"
INSTALL="$ROOT/install"
DATA="$ROOT/data"

mkdir -p "$CACHE_DIR"
if ! echo "$SHA256  $JAR" | sha256sum -c - >/dev/null 2>&1; then
  curl -fsSL --retry 3 --connect-timeout 20 --max-time 300 -o "$JAR.$$" \
    "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/$VERSION/embedded-postgres-binaries-linux-amd64-$VERSION.jar"
  echo "$SHA256  $JAR.$$" | sha256sum -c -
  mv -f "$JAR.$$" "$JAR"
fi

rm -rf "$ROOT"
mkdir -p "$INSTALL"
unzip -p "$JAR" postgres-linux-x86_64.txz | tar -xJ -C "$INSTALL"

PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
printf 'postgres' > "$ROOT/password"
"$INSTALL/bin/initdb" -D "$DATA" -U postgres --pwfile="$ROOT/password" --auth=scram-sha-256 \
  --encoding=UTF8 --locale=C >/dev/null
"$INSTALL/bin/postgres" --single -D "$DATA" postgres <<< "CREATE DATABASE robots;" >/dev/null 2>&1
"$INSTALL/bin/pg_ctl" -D "$DATA" -l "$ROOT/postgres.log" -w -t 60 start -o \
  "-h 127.0.0.1 -p $PORT -c unix_socket_directories= -c timezone=UTC -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=500" ||
  { cat "$ROOT/postgres.log" >&2; exit 1; }

echo "CI_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:$PORT/robots" >> "${GITHUB_ENV:-/dev/stdout}"
