# herdr-opendeck

Mirror your [Herdr](https://herdr.dev) session onto a Stream Deck through
[OpenDeck](https://github.com/nekename/OpenDeck), written in Go.

Keys become live tiles for Herdr workspaces: label, repository, branch, and a
background colour carrying state (green focused, yellow working, red blocked).
Pressing a tile focuses that workspace in Herdr and raises the hosting
terminal application.

Status: experimental proof of concept. See [DESIGN.md](DESIGN.md) for the
target UX.

## Requirements

- Herdr 0.8+ with the `herdr` CLI on PATH
- OpenDeck 2.14+
- Go 1.22+ to build

## Install

```sh
sh scripts/install.sh
```

builds the plugin for the host platform (a universal arm64 + x86_64 binary
on macOS), installs the `.sdPlugin` bundle into OpenDeck's plugins
directory, and records the `herdr` CLI path for the plugin to use. For the
official Elgato Stream Deck app, use `sh scripts/install-elgato.sh` instead —
the same bundle works in both hosts.

Restart OpenDeck, then place the "Herdr Space" action on the keys you
want to participate — keys without the action are never touched, which is how
you reserve keys for other uses. With OpenDeck quit,
`python3 scripts/fill-profile.py` places the action on every empty key of a
profile in one go.

Spaces fill the participating keys in stable slots with live state
backgrounds. When there are more spaces than keys, the last two keys become
`←`/`→` pagers with the page count below the arrows.

## Layout

- `main.go` — OpenAction plugin event loop
- `internal/deck` — Stream Deck / OpenAction websocket protocol
- `internal/herdr` — herdr CLI bridge (snapshot polling, focus, git context)
- `internal/render` — SVG key tile rendering
- `plugin/` — `.sdPlugin` bundle assets (manifest, icons)

## License

MIT
