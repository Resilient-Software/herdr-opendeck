#!/bin/sh
# Build the universal plugin binary and install the .sdPlugin bundle into
# the Elgato Stream Deck app's plugins directory.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
uuid="com.thomasrooney.herdrdeck.sdPlugin"

[ "$(uname -s)" = "Darwin" ] || { echo "the Elgato Stream Deck app is macOS/Windows only; this script covers macOS" >&2; exit 1; }

target="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/$uuid"
sh "$repo/scripts/build-universal.sh" "$target/bin/herdr-opendeck"
cp -R "$repo/plugin/manifest.json" "$repo/plugin/icons" "$target/"

# Tell the plugin where herdr lives, since the Stream Deck app inherits a
# minimal PATH.
command -v herdr > "$target/herdr-path.txt" 2>/dev/null || true

echo "installed to $target"
echo "restart the Stream Deck app to pick it up"
