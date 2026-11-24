#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
HEAD=packages/ui-tokens/assets/robots-head.svg
MONO=packages/ui-tokens/assets/robots-head-mono.svg
TILE="#f4f6f8"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

head_png() { rsvg-convert -w "$1" -h "$1" "$HEAD" -o "$2"; }
on_canvas() { magick -size "$1x$1" "xc:$2" "$3" -gravity center -composite "$4"; }
mono_png() { rsvg-convert -w "$1" -h "$1" "$MONO" -o "$2"; }

head_png 717 "$TMP/head-717.png"
head_png 560 "$TMP/head-560.png"
head_png 640 "$TMP/head-640.png"

on_canvas 1024 "$TILE" "$TMP/head-717.png" apps/mobile/assets/icon.png
on_canvas 1024 none "$TMP/head-560.png" apps/mobile/assets/adaptive-icon.png
magick -size 1024x1024 "xc:$TILE" apps/mobile/assets/icon-background.png
mono_png 560 "$TMP/mono-560.png"
on_canvas 1024 none "$TMP/mono-560.png" apps/mobile/assets/monochrome-icon.png
on_canvas 1024 none "$TMP/head-640.png" apps/mobile/assets/splash-icon.png
mono_png 64 "$TMP/mono-64.png"
on_canvas 72 none "$TMP/mono-64.png" apps/mobile/assets/notification-icon.png
head_png 128 apps/mobile/assets/favicon.png

head_png 640 "$TMP/mac-head.png"
magick -size 1024x1024 xc:none -fill "$TILE" -draw "roundrectangle 100,100 924,924 185,185" \
  "$TMP/mac-head.png" -gravity center -composite apps/desktop/assets/icon-macos.png
on_canvas 1024 "$TILE" "$TMP/head-717.png" apps/desktop/assets/icon.png
head_png 256 "$TMP/ico-256.png"; head_png 48 "$TMP/ico-48.png"; head_png 32 "$TMP/ico-32.png"; head_png 16 "$TMP/ico-16.png"
magick "$TMP/ico-16.png" "$TMP/ico-32.png" "$TMP/ico-48.png" "$TMP/ico-256.png" apps/desktop/assets/icon.ico

P=apps/web/public
head_png 16 "$P/favicon-16x16.png"
head_png 32 "$P/favicon-32x32.png"
head_png 128 "$P/favicon.png"
magick "$P/favicon-16x16.png" "$P/favicon-32x32.png" "$TMP/ico-48.png" "$P/favicon.ico"
cp "$HEAD" "$P/favicon.svg"
for size in 180 192 512; do
  head_png $((size * 7 / 10)) "$TMP/tile-head.png"
  on_canvas "$size" "$TILE" "$TMP/tile-head.png" "$TMP/tile-$size.png"
done
cp "$TMP/tile-180.png" "$P/apple-touch-icon.png"
cp "$TMP/tile-192.png" "$P/icon-192.png"
cp "$TMP/tile-512.png" "$P/icon-512.png"
echo "brand icons generated from $HEAD"
