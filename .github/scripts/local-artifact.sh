#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 upload <name> <path>... | download <name-pattern> <destination> [run-id]" >&2
  exit 2
}

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${ROBOTS_CI_ARTIFACTS:-$HOME/ci-artifacts/${GITHUB_REPOSITORY##*/}}"
retention_days=7

case "${1:-}" in
  upload)
    [[ $# -ge 3 ]] || usage
    name="$2"
    shift 2
    [[ $name =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid artifact name: $name" >&2; exit 2; }
    run_dir="$root/$GITHUB_RUN_ID"
    mkdir -p "$run_dir"
    find "$root" -mindepth 1 -maxdepth 1 -type d -mtime "+$retention_days" -exec rm -rf {} +
    python3 "$scripts/local-artifact-zip.py" "$run_dir/$name.zip.part" "$@" ||
      { rm -f "$run_dir/$name.zip.part"; exit 1; }
    mv -f "$run_dir/$name.zip.part" "$run_dir/$name.zip"
    echo "Stored $run_dir/$name.zip"
    ;;
  download)
    [[ $# -eq 3 || $# -eq 4 ]] || usage
    pattern="$2"
    destination="$3"
    run_id="${4:-$GITHUB_RUN_ID}"
    [[ $pattern =~ ^[A-Za-z0-9._*-]+$ ]] || { echo "Invalid artifact pattern: $pattern" >&2; exit 2; }
    [[ $run_id =~ ^[0-9]+$ ]] || { echo "Invalid run id: $run_id" >&2; exit 2; }
    mkdir -p "$destination"
    shopt -s nullglob
    found=0
    for archive in "$root/$run_id"/$pattern.zip; do
      python3 "$scripts/../../scripts/extract-playwright-artifacts.py" "$archive" "$destination/$(basename "$archive" .zip)"
      found=$((found + 1))
    done
    echo "Extracted $found artifact(s) matching $pattern from run $run_id"
    ;;
  *)
    usage
    ;;
esac
