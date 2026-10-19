#!/bin/sh
# Render every key image variant to dist/sheet/ and tile them into contact
# sheets at the physical key size (72 px) and at 2x (144 px). Needs
# rsvg-convert and ImageMagick.
set -eu
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
npx esbuild scripts/render-sheet.ts --bundle --platform=node --format=cjs --outfile="$tmp/sheet.cjs" >/dev/null
node "$tmp/sheet.cjs"
cd dist/sheet
for size in 72 144; do
	mkdir -p "png$size"
	for f in keys/*.svg; do
		name="$(basename "$f" .svg)"
		rsvg-convert -w "$size" -h "$size" -b '#000000' "$f" -o "png$size/$name.png"
	done
	magick montage -label '%t' -pointsize 9 -fill '#a6adc8' -background '#11111b' -geometry "+6+6" -tile 8x "png$size"/*.png "sheet-$size.png"
done
echo "sheets in dist/sheet/"
