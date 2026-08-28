# herdr-opendeck

Mirror your [Herdr](https://herdr.dev) session onto a Stream Deck.
TypeScript on the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk);
runs in both the Elgato Stream Deck app and
[OpenDeck](https://github.com/nekename/OpenDeck).

Keys become live tiles for Herdr workspaces: label, repository, branch, and a
background colour carrying state (green focused, yellow working, red blocked).
Pressing a tile focuses that workspace in Herdr and raises the hosting
terminal application.

Status: experimental proof of concept. See [DESIGN.md](DESIGN.md) for the
target UX.

## Requirements

- Herdr 0.8+ (the plugin finds the `herdr` CLI via `HERDR_PATH`, the
  recorded install path, the official install locations, or a running
  herdr process)
- Elgato Stream Deck 7.1+, or OpenDeck 2.14+ with Node.js 24+ installed
- Node.js 24+ and npm to build

## Install

```sh
sh scripts/install.sh
```

builds the bundle and installs it into OpenDeck's plugins directory,
recording the `herdr` CLI path for the plugin to use. For the official
Elgato Stream Deck app, use `sh scripts/install-elgato.sh` instead — the
same bundle works in both hosts.

Restart OpenDeck, then place the "Herdr Space" action on the keys you
want to participate — keys without the action are never touched, which is how
you reserve keys for other uses. With OpenDeck quit,
`python3 scripts/fill-profile.py` places the action on every empty key of a
profile in one go.

Spaces fill the participating keys in stable slots with live state
backgrounds. When there are more spaces than keys, the last two keys become
`←`/`→` pagers with the page count below the arrows.

## Layout

- `src/plugin.ts` — entry point; registers the actions and connects
- `src/controller.ts` — key coordination: slots, paging, roles, repaints
- `src/actions.ts` — the Herdr Space and New Herdr Space actions
- `src/herdr.ts` — herdr CLI bridge (discovery, snapshot polling, focus,
  git context, client raising)
- `src/layout.ts` — pure key-assignment and paging logic
- `src/render.ts` — SVG key tile rendering
- `plugin/` — `.sdPlugin` bundle assets (manifest, icons)
- `test/` — vitest suites

## License

MIT
