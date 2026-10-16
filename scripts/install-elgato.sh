#!/bin/sh
# Build the plugin bundle and install it into the Elgato Stream Deck app's
# plugins directory. Stream Deck 7.1+ runs it on its bundled Node.js; apps
# older than 7.6 get a copy without the Neo Infobar.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
uuid="com.resilientsoftware.herdrdeck.sdPlugin"

[ "$(uname -s)" = "Darwin" ] || { echo "the Elgato Stream Deck app is macOS/Windows only; this script covers macOS" >&2; exit 1; }

(cd "$repo" && npm install --no-audit --no-fund --silent && npm run --silent build)

target="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/$uuid"
mkdir -p "$target"
cp -R "$repo/plugin/manifest.json" "$repo/plugin/icons" "$repo/plugin/bin" "$repo/plugin/ui" "$repo/plugin/layouts" "$target/"

app_plist="/Applications/Elgato Stream Deck.app/Contents/Info.plist"
if [ -f "$app_plist" ]; then
	app_version="$(plutil -extract CFBundleShortVersionString raw -o - "$app_plist" 2>/dev/null || true)"
	major="$(echo "$app_version" | cut -d. -f1)"
	minor="$(echo "$app_version" | cut -d. -f2)"
	case "$major$minor" in
		*[!0-9]* | "") ;;
		*)
			if [ "$major" -lt 7 ] || { [ "$major" -eq 7 ] && [ "$minor" -lt 6 ]; }; then
				node "$repo/scripts/legacy-manifest.mjs" "$target/manifest.json"
				echo "Stream Deck $app_version is older than 7.6: installed without the Neo Infobar"
			fi
			;;
	esac
fi

# Record where herdr lives, since the host may run with a minimal PATH; the
# plugin also probes the official install locations and ps on its own.
command -v herdr > "$target/herdr-path.txt" 2>/dev/null || true

echo "installed to $target"
echo "restart the Stream Deck app to pick it up"
