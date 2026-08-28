#!/bin/sh
# Build a universal (arm64 + x86_64) macOS binary at the given output path.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$1"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$repo" && GOOS=darwin GOARCH=arm64 go build -o "$tmp/arm64" .)
(cd "$repo" && GOOS=darwin GOARCH=amd64 go build -o "$tmp/amd64" .)
mkdir -p "$(dirname "$out")"
lipo -create -output "$out" "$tmp/arm64" "$tmp/amd64"
