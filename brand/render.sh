#!/bin/bash
# Renders the brand images from their HTML sources with headless Chrome, so
# they use the same web fonts as the site:
#   brand/og-image.html          -> og-image.png          (1200x630)
#   brand/apple-touch-icon.html  -> apple-touch-icon.png  (180x180)
#
# Headless Chrome often stays alive after writing the screenshot, so each
# render runs in the background and is killed once the PNG has landed.
# After re-rendering og-image.png, bump the ?v= on the og:image and
# twitter:image tags in index.html so social sites refetch it.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

render() {
  local src="$1" out="$2" size="$3"
  local profile tmp pid
  profile="$(mktemp -d)"
  tmp="$(mktemp -d)/shot.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="$profile" --window-size="$size" --virtual-time-budget=8000 \
    --screenshot="$tmp" "file://$PWD/$src" >/dev/null 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do
    [ -s "$tmp" ] && break
    sleep 1
  done
  sleep 1
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -rf "$profile"
  if [ ! -s "$tmp" ]; then
    echo "Failed to render $src" >&2
    exit 1
  fi
  mv "$tmp" "$out"
  echo "Rendered $out ($(sips -g pixelWidth -g pixelHeight "$out" | awk '/pixel/ {printf "%s ", $2}'))"
}

render brand/og-image.html og-image.png 1200,630
render brand/apple-touch-icon.html apple-touch-icon.png 180,180
