#!/bin/sh
# Build the plugin binary for this machine and install the .sdPlugin bundle
# into OpenDeck's plugins directory.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
uuid="com.thomasrooney.herdrdeck.sdPlugin"

case "$(uname -s)-$(uname -m)" in
	Darwin-arm64) triple="aarch64-apple-darwin" ;;
	Darwin-x86_64) triple="x86_64-apple-darwin" ;;
	Linux-aarch64) triple="aarch64-unknown-linux-gnu" ;;
	Linux-x86_64) triple="x86_64-unknown-linux-gnu" ;;
	*) echo "unsupported platform" >&2; exit 1 ;;
esac

case "$(uname -s)" in
	Darwin) plugins_dir="$HOME/Library/Application Support/opendeck/plugins" ;;
	Linux) plugins_dir="${XDG_DATA_HOME:-$HOME/.local/share}/opendeck/plugins" ;;
esac

target="$plugins_dir/$uuid"
mkdir -p "$target/$triple/bin"
(cd "$repo" && go build -o "$target/$triple/bin/herdr-opendeck" .)
cp -R "$repo/plugin/manifest.json" "$repo/plugin/icons" "$target/"

# Tell the plugin where herdr lives, since OpenDeck.app inherits a minimal PATH.
command -v herdr > "$target/herdr-path.txt" 2>/dev/null || true

echo "installed to $target"
echo "restart OpenDeck (or reload plugins) to pick it up"
