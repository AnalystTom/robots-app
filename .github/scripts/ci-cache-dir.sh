#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[a-z0-9-]+$ ]]; then
  echo "usage: $0 <name>" >&2
  exit 2
fi

dir="${ROBOTS_CI_CACHE:-$HOME/.cache/robots-ci}/$1"
mkdir -p "$dir"
printf '%s\n' "$dir"
