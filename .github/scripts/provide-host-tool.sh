#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 dpkg|xvfb-run" >&2
  exit 2
fi

case "$1" in
  dpkg)
    commands=(dpkg)
    package=d/dpkg/dpkg-1.23.11-1-x86_64.pkg.tar.zst
    sha256=47780df7542be2198013106a79d821b62e082462d4ebb8fdc9b527519cc2a63c
    ;;
  xvfb-run)
    commands=(xvfb-run Xvfb)
    package=x/xorg-server-xvfb/xorg-server-xvfb-21.1.25-2-x86_64.pkg.tar.zst
    sha256=52c6d0394109b0bdfd0e4d00dd8d89d7e38bfe7576d96145179f216480eb7564
    ;;
  *)
    echo "unknown tool: $1" >&2
    exit 2
    ;;
esac

missing=()
for command in "${commands[@]}"; do
  command -v "$command" >/dev/null || missing+=("$command")
done
[[ ${#missing[@]} -eq 0 ]] && exit 0

if [[ ! -f /etc/arch-release ]]; then
  echo "::error::${missing[*]} not installed, and this runner is not Arch-based so a job-local copy cannot be provided."
  exit 1
fi

dest="${RUNNER_TEMP:-/tmp}/host-tools/$1"
archive="$dest.pkg.tar.zst"
mkdir -p "$dest"
curl -fsSL --retry 3 -o "$archive" "https://archive.archlinux.org/packages/$package"
echo "$sha256  $archive" | sha256sum -c -
tar --zstd -xf "$archive" -C "$dest" usr/bin
echo "$dest/usr/bin" >> "${GITHUB_PATH:-/dev/stdout}"
