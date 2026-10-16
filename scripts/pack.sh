#!/bin/sh
# Build, validate, and pack the plugin into a distributable
# .streamDeckPlugin installer under dist/.
#
#   sh scripts/pack.sh            Stream Deck 7.6+, with the Neo Infobar
#   sh scripts/pack.sh --legacy   Stream Deck 7.1+, without the Neo Infobar
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
uuid="com.resilientsoftware.herdrdeck"

legacy=false
case "${1:-}" in
	"") ;;
	--legacy) legacy=true ;;
	*) echo "usage: pack.sh [--legacy]" >&2; exit 2 ;;
esac

cd "$repo"
npm install --no-audit --no-fund --silent
npm run --silent build

if $legacy; then
	stage="dist/legacy"
	output="dist/$uuid-legacy.streamDeckPlugin"
else
	stage="dist"
	output="dist/$uuid.streamDeckPlugin"
fi

rm -rf "$stage/$uuid.sdPlugin" "$stage/$uuid.streamDeckPlugin" "$output"
mkdir -p "$stage/$uuid.sdPlugin"
cp -R plugin/manifest.json plugin/icons plugin/bin plugin/ui plugin/layouts "$stage/$uuid.sdPlugin/"
if $legacy; then
	node scripts/legacy-manifest.mjs "$stage/$uuid.sdPlugin/manifest.json"
fi

npx --yes @elgato/cli@latest validate "$stage/$uuid.sdPlugin"
npx --yes @elgato/cli@latest pack "$stage/$uuid.sdPlugin" --output "$stage"
if [ "$stage/$uuid.streamDeckPlugin" != "$output" ]; then
	mv "$stage/$uuid.streamDeckPlugin" "$output"
fi

echo "packed: $output"
