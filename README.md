# Herdr Deck

Mirror your [Herdr](https://herdr.dev) session onto a Stream Deck and drive
your coding agents from it.
TypeScript on the official [Stream Deck SDK](https://docs.elgato.com/streamdeck/sdk);
runs in both the Elgato Stream Deck app and
[OpenDeck](https://github.com/nekename/OpenDeck).

Free to use. Apache-2.0. Not an official Herdr or Elgato product.

## How it works

Demo: [deck.resilientsoftware.co.uk](https://deck.resilientsoftware.co.uk/) — press the keys of a 3D Stream Deck in your browser.

**Live tiles.** Keys become live tiles for Herdr workspaces: label,
repository, branch, and a background colour carrying state (green focused,
yellow working, red blocked). Pressing a tile focuses that workspace in Herdr
and raises the hosting terminal application. When there are more workspaces
than keys, the last two keys become `←`/`→` pagers. Updates stream from the
herdr server socket (`events.subscribe`), so state changes land in well under
a second; when the socket is unavailable the plugin falls back to polling the
CLI at 1 Hz.

**Idle isn't always done.** Agents often go quiet while subagents,
background shells or a scheduled loop keep running. With the optional
[herdr-agent-activity](https://github.com/Resilient-Software/herdr-agent-activity)
plugin installed, the deck shows that work: a blue tile with an icon and a
count for each kind still running (subagents, background shells, monitors),
and a dark mauve tile with a loop or clock icon and a countdown such as `17M`
for a scheduled check. A plain tile really means finished. The Agent Summary
key counts every state on one key, or on the Infobar of a Stream Deck Neo,
and a press jumps to the workspace that needs you most, blocked first.

**Drive agents.** Control keys send a slash command, a phrase, key presses or
the next value of a cycle to the agent you are focused on, or to a workspace
you pin the key to, and show that target on the key (`> api-server`,
`#2 webapp`). They never type into an agent waiting at a permission prompt;
Send Keys still goes through, so its default `esc` can interrupt or dismiss.

See [DESIGN.md](DESIGN.md) for the full UX.

## Actions

| Action | What it does | Settings |
|---|---|---|
| Herdr Space | One live workspace tile per key; press to focus it | none |
| New Herdr Space | Creates a workspace and focuses it | none |
| Agent Summary | Counts workspaces by state, as a ring or a list, also on the Neo Infobar; press focuses the one that needs you most | look |
| Slash Command | Sends a command such as `/review`, then Enter | command, target |
| Send Text | Types a phrase, then Enter unless turned off | text, press Enter, target |
| Send Keys | Sends key presses; `esc` by default | keys, target |
| Cycle | Steps through values: `/model opus`, then `sonnet`, then `haiku` | command, values, target |
| New Tab | Opens a tab in the target pane's folder, or a folder you choose | folder, target |

The target is the focused agent unless you pin the key to a workspace.

## Install

Marketplace: [Herdr Deck on Elgato Marketplace](https://marketplace.elgato.com/product/herdr-deck-73e1ae6d-04ef-499c-9214-9d5c6e576126) — one click in the Stream Deck app, keeps itself up to date, buys me a beer.

Or build from source:

```sh
sh scripts/install.sh
```

builds the bundle and installs it into OpenDeck's plugins directory,
recording the `herdr` CLI path for the plugin to use. For the official
Elgato Stream Deck app, use `sh scripts/install-elgato.sh` instead — the
same bundle works in both hosts. On a Stream Deck app older than 7.6 it
installs a copy without the Neo Infobar and says so. `sh scripts/pack.sh`
produces a `.streamDeckPlugin` installer under `dist/` (`--legacy` packs the
build for older apps); tagged releases publish one.

Herdr itself can install it: `herdr plugin install Resilient-Software/herdr-opendeck`.

Restart OpenDeck, then place the "Herdr Space" action on the keys you
want to participate — keys without one of the plugin's actions are never
touched, which is how you reserve keys for other uses. With OpenDeck quit,
`python3 scripts/fill-profile.py` places the action on every empty key of a
profile in one go.

Spaces fill the participating keys in stable slots with live state
backgrounds. When there are more spaces than keys, the last two keys become
`←`/`→` pagers with the page count below the arrows. Agent Summary and the
control keys can go anywhere, including between space keys; the spaces skip
them. Configure a control key in its property inspector.

## Requirements

- Herdr 0.8.2+ — CI runs the compatibility probe (`scripts/compat-check.sh`)
  and the end-to-end suite against v0.8.2 and the latest release weekly. The
  plugin finds the `herdr` CLI via `HERDR_PATH`, the recorded install path,
  the official install locations, or a running herdr process
- Elgato Stream Deck 7.6+ (the Neo Infobar needs it). Builds from source
  also install on Stream Deck 7.1–7.5, without the Infobar. Or OpenDeck 2.14+
  with Node.js 24+ installed
- macOS. The Elgato app also runs on Windows, but the plugin has not been tested there
- Node.js 24+ and npm to build

## Development

```sh
npm ci
npm run lint && npm run typecheck && npm test
npm run build && npm run e2e
```

`npm run e2e` runs the built plugin against a fake Stream Deck host and a
throwaway sandbox herdr server, never your own session, presses keys the way
a user would and checks what reaches the sandbox's panes. `HERDR_BIN` picks the herdr binary (default: `herdr` on `PATH`).
Key images, boards (PNG via `rsvg-convert`) and `summary.json` land in
`e2e-out/`.

## Layout

- `src/plugin.ts` — entry point; registers the actions and connects
- `src/controller.ts` — snapshot loop and key coordination: slots, paging,
  roles, repaints
- `src/controls.ts` — Agent Summary, Infobar and control key behaviour
- `src/actions.ts` — the action classes
- `src/state.ts` — workspace states, summary counts, attention order and
  target resolution
- `src/keys.ts` — Send Keys parsing and Cycle values
- `src/herdr.ts` — herdr bridge (socket-first snapshot, focus, create, send
  and new tab with CLI fallback, event-churn filtering, git context, client
  raising)
- `src/socket.ts` — herdr server socket client (newline-JSON requests and
  the `events.subscribe` stream)
- `src/schedule.ts` — poll cadence and event coalescing
- `src/layout.ts` — pure key-assignment and paging logic
- `src/activity.ts` — herdr-agent-activity tokens
- `src/render.ts` — SVG rendering: space tiles, summary, Infobar, control keys
- `src/glyphs.ts` — activity icons
- `plugin/` — `.sdPlugin` bundle assets (manifest, icons, property
  inspectors, Infobar layout)
- `scripts/e2e/` — end-to-end harness
- `test/` — vitest suites

## License

Apache-2.0. See [LICENSE](LICENSE).
