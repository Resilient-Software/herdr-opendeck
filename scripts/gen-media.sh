#!/bin/sh
# Render the Marketplace listing media: gen-media.ts writes composition
# SVGs, rsvg-convert rasterizes them at the Maker Console's exact sizes.
set -eu
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
npx esbuild scripts/gen-media.ts --bundle --platform=node --format=cjs --outfile="$tmp/gen.cjs" >/dev/null
node "$tmp/gen.cjs"
cd dist/media
for f in *.svg; do rsvg-convert -w 1920 -h 960 "$f" -o "${f%.svg}.png"; done
rsvg-convert -w 288 -h 288 "$repo/plugin/icons/plugin.svg" -o icon.png
echo "media in dist/media/"
