#!/bin/sh
# Build, validate, and pack the plugin into a distributable
# .streamDeckPlugin installer under dist/.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
uuid="com.resilientsoftware.herdrdeck"

cd "$repo"
npm install --no-audit --no-fund --silent
npm run --silent build

rm -rf "dist/$uuid.sdPlugin" "dist/$uuid.streamDeckPlugin"
mkdir -p "dist/$uuid.sdPlugin"
cp -R plugin/manifest.json plugin/icons plugin/bin plugin/ui "dist/$uuid.sdPlugin/"

npx --yes @elgato/cli@latest validate "dist/$uuid.sdPlugin"
npx --yes @elgato/cli@latest pack "dist/$uuid.sdPlugin" --output dist

echo "packed: dist/$uuid.streamDeckPlugin"
