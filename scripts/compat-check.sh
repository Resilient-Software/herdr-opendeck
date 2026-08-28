#!/bin/sh
# Boots an isolated herdr session from the given binary and runs the
# plugin's compatibility probe against it.
#
#   sh scripts/compat-check.sh /path/to/herdr
#
# The session lives in a throwaway sandbox (own socket, config, and state),
# so it never touches a real herdr session on the machine.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
binary="${1:?usage: compat-check.sh /path/to/herdr}"
binary="$(cd "$(dirname "$binary")" && pwd)/$(basename "$binary")"

sandbox="$(mktemp -d)"
export HERDR_SOCKET_PATH="$sandbox/herdr.sock"
export XDG_CONFIG_HOME="$sandbox/config"
export XDG_DATA_HOME="$sandbox/data"
export XDG_STATE_HOME="$sandbox/state"
export HERDR_PATH="$binary"
export TERM="${TERM:-xterm-256color}"
# This script may itself run inside a herdr pane under a real terminal;
# the probe session must not inherit that identity or the terminal's
# integration (herdr would try to drive it, e.g. "ghostty error -2").
unset HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID HERDR_BIN_PATH
unset TERM_PROGRAM TERM_PROGRAM_VERSION GHOSTTY_RESOURCES_DIR GHOSTTY_BIN_DIR KITTY_WINDOW_ID WEZTERM_EXECUTABLE ITERM_SESSION_ID

cleanup() {
	"$binary" server stop >/dev/null 2>&1 || true
	[ -n "${server_pid:-}" ] && kill "$server_pid" >/dev/null 2>&1 || true
	rm -rf "$sandbox"
}
trap cleanup EXIT INT TERM

"$binary" --version

"$binary" server >/dev/null 2>&1 &
server_pid=$!

tries=0
until "$binary" status server 2>/dev/null | grep -q "status: running"; do
	tries=$((tries + 1))
	[ "$tries" -ge 60 ] && { echo "COMPAT FAIL: herdr server did not start" >&2; exit 1; }
	sleep 0.5
done
"$binary" status server

(cd "$repo" && npx esbuild scripts/compat-check.ts --bundle --platform=node --format=esm \
	--banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
	--outfile="$sandbox/compat-check.mjs" >/dev/null)
node "$sandbox/compat-check.mjs"
