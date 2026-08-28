#!/bin/sh
# Build the plugin bundle and install it into the Elgato Stream Deck app's
# plugins directory. Stream Deck 7.1+ runs it on its bundled Node.js.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
uuid="com.thomasrooney.herdrdeck.sdPlugin"

[ "$(uname -s)" = "Darwin" ] || { echo "the Elgato Stream Deck app is macOS/Windows only; this script covers macOS" >&2; exit 1; }

(cd "$repo" && npm install --no-audit --no-fund --silent && npm run --silent build)

target="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/$uuid"
mkdir -p "$target"
cp -R "$repo/plugin/manifest.json" "$repo/plugin/icons" "$repo/plugin/bin" "$target/"

# Record where herdr lives, since the host may run with a minimal PATH; the
# plugin also probes the official install locations and ps on its own.
command -v herdr > "$target/herdr-path.txt" 2>/dev/null || true

echo "installed to $target"
echo "restart the Stream Deck app to pick it up"
