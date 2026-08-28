# Herdr OpenDeck UX

## Product stance

Build a live physical index of Herdr, not a configurable macro pad. **Spaces are the only top-level concept**: every usable key is a space tile. Aggregate `agent_status` on each space carries the attention signal; pane-level drill-down is a possible later stage, not v1.

Do not add pins, per-key assignments, modes, or tab keys in v1.

## Physical map

Stream Deck MK.2 coordinates are zero-based. Slot numbers are row-major.

**Keys are opted in by placing the Herdr Space action on them in OpenDeck.** Any key without the action is never rendered to, bound, or handled — the user reserves keys (for example an fn key mapping at top-right) simply by leaving the action off them. Placement is the configuration; the plugin has no hardcoded reserved slots.

Example placement on an MK.2 with the top-right key reserved:

|      | Col 0 | Col 1 | Col 2 | Col 3 | Col 4 |
|------|-------|-------|-------|-------|-------|
| Row 0 | Space | Space | Space | Space | *(no action — user's fn key)* |
| Row 1 | Space | Space | Space | Space | Space |
| Row 2 | Space | Space | Space | Space or pager ← | Space or pager → |

- Spaces fill the participating keys row-major, ordered by `number`, then `workspace_id`; keep surviving workspace IDs in their existing slots between polls so keys do not shuffle unnecessarily.
- **The pager is dynamic and takes two keys.** While spaces fit the participating keys there is no pager: every key is a space tile and unused keys are black. With more spaces than keys, the last two keys become `←` and `→` pagers and the remaining keys page through the spaces.
- An external focus change reveals the page containing the newly focused workspace.

## Key image language

Author each key at `144 × 144`, system sans text, flat geometry, no gradients, shadows, or decorative animation.

**The whole tile background carries state.** No rings: the key lights up as a solid field of colour behind the text.

### Tile anatomy

- **Background:** state colour (see below). This is the primary signal, readable across a room.
- **Corner:** workspace number.
- **Centre:** the name exactly as Herdr presents it. Prefer `label`, then `terminal_title_stripped`, then the basename of `cwd`, then a shortened ID. One line, ellipsized.
- **Text budget — where it operates:** below the name, the repository directory name and `⎇ branch`, derived from the workspace's worktree checkout or its first pane's `cwd`. Omit lines that do not apply rather than shrinking type.
- **Footer:** literal lifecycle word when the background is plain, so state is never colour-only.

### Status language

| State | Background | Text |
|-------|------------|------|
| focused / selected | green `#A6E3A1` | dark `#1E1E2E` |
| `working` | yellow `#F9E2AF` | dark `#1E1E2E` |
| `blocked` (needs input) | red `#F38BA8` | dark `#1E1E2E` |
| `idle` / `done` / `unknown` — neither working nor focused | plain `#1E1E2E` | light `#CDD6F4`, footer carries the word |

Precedence: focused > blocked > working > plain. Use `#A6ADC8` for metadata text on plain tiles. Workspace keys use Herdr's aggregate `agent_status`; do not recompute it in the plugin.

Working is a static yellow field through stage 3; any motion experiment comes later and must not reduce legibility.

### Pager keys (dynamic)

Pagers exist only while spaces exceed the participating keys. They are controls, not data tiles:

- Two keys: a large `←` and a large `→` arrow, each with the `<current>/<total>` page indicator below.
- Press moves one page in that direction; no wrap and no auto-repeat.
- If the focused space is off the visible page, the arrow pointing toward it is accented.
- When the space count fits the keys again, both pager keys return to being space tiles.

## Interaction vocabulary

| Key | Press | Long press |
|-----|-------|------------|
| Space | Focus workspace in Herdr **and raise the application hosting the Herdr client** (e.g. the terminal it runs in) | Same as press; no hidden alternate action |
| Pager `←` / `→` (only when present) | One page in that direction | Same as press |
| Empty key | No-op | No-op |
| Key without the action | Never touched | Never touched |

- Content keys focus exactly once on key-up. Holding them must not create a second action.
- Pager keys act once on key-up, one page in their direction. Do not auto-repeat or wrap at either end.
- Key-down adds immediate pressed feedback. After a focus request, render `FOCUSING…` in the footer until the snapshot confirms it (the background does not turn green until confirmed). On command failure, render `FAILED · TRY AGAIN` in red for one second, then restore live state. Do not use the host's generic alert overlay.
- Keep gesture state per key context; cancel timers on disappearance or disconnect.

## Overflow and live updates

- Without a pager, all 14 keys are space tiles. With a pager, pages contain 13 spaces.
- A manual page change is view-only and persists until the user focuses an item or Herdr's focused ID changes externally.
- Additions fill the first free position after existing IDs. Removals compact; clamp the page only when its old index no longer exists.
- Poll `herdr api snapshot` at about 1 Hz, but redraw only keys whose image model changed.
- The pager, when present, always occupies the bottom-right key; never reinterpret a space tile as navigation.

## Empty, loading, and offline states

- **Starting:** top-left shows `HERDR · CONNECTING`; every other usable key is black.
- **Online, no workspaces:** top-left shows `NO SPACES · OPEN HERDR`; all other data keys are black and pagers show `0`.
- **Unused positions:** fully black and inert; do not show fake slot numbers or plus buttons.
- **Transient poll failure:** keep the last good frame for two failed polls to avoid flicker.
- **Offline after three failures:** freeze and dim last-known labels on plain backgrounds, disable all focus and page actions, and show `HERDR OFFLINE` in red text on the top-left key. Recover automatically on the next valid snapshot.

## Staged roadmap

### Stage 1 — single-key POC (built)

One `Herdr Space` action on any usable key:

- Poll the snapshot at 1 Hz and show the lowest-numbered workspace.
- Render its number, the label as Herdr presents it, repository and `⎇ branch`, on a state-coloured background (green focused / yellow working / red blocked / plain otherwise).
- Press to focus that workspace and raise the hosting application.
- Render explicit `HERDR OFFLINE` and empty states.
- Prove connect/register, `willAppear`/`willDisappear`, image updates, and focus on macOS through OpenDeck.

### Stage 2 — live deck (built)

Coordinate every participating key as a space tile: stable ordering, state backgrounds, empty states, and opt-in placement only. No pager yet; sessions with more spaces than keys show the first page.

### Stage 3 — paging and hardening (built)

Enable the dynamic two-key pager (appears only when spaces exceed the keys). Add focus-pending/failure feedback, offline grace and frozen state, redraw deduplication, page clamping, and layout/event tests.

### Stage 4 — device polish

Calibrate type, colours, brightness, and acknowledgement timing on a physical MK.2. Add working-state motion only if it remains legible and does not disturb 1 Hz updates. Ship the OpenDeck profile/install path after a full reconnect, hot-plug, overflow, and offline recovery pass.

## Non-goals

- No Stream Deck+ pin model, dial/touch-strip concepts, destructive actions, or question answering.
- No automatic launching of Herdr.
- No optimistic focus state; the snapshot is authoritative.
- No touching keys the user has not placed the action on, under any circumstance.
