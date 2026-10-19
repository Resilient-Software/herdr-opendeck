# Herdr Deck UX

## Product stance

Build a live physical index of Herdr first, and a small set of agent controls second.

- **The spaces grid is the default and needs no setup.** Placing the Herdr Space action on keys is the whole configuration: every such key becomes a live workspace tile. Herdr's aggregate `agent_status` on each workspace carries the attention signal.
- **Control keys are opt-in and take per-key settings.** Agent Summary, Slash Command, Send Text, Send Keys, Cycle and New Tab are separate actions the user places deliberately and configures in the property inspector. Each does one thing, and a control key always shows on its face where a press will go.
- No modes and no hidden alternate actions: a key does the same thing on every press, and a long press is the same as a press.

## Physical map

Stream Deck MK.2 coordinates are zero-based. Slot numbers are row-major.

**Keys are opted in by placing an action on them.** Any key without one of this plugin's actions is never rendered to, bound, or handled — the user reserves keys (for example an fn key mapping at top-right) simply by leaving the action off them. Placement is the configuration; the plugin has no hardcoded reserved slots.

Example placement on an MK.2 with the top-right key reserved:

|      | Col 0 | Col 1 | Col 2 | Col 3 | Col 4 |
|------|-------|-------|-------|-------|-------|
| Row 0 | Space | Space | Space | Space | *(no action — user's fn key)* |
| Row 1 | Space | Space | Space | Space | Space |
| Row 2 | Space | Space | Space | Space or pager ← | Space or pager → |

- Spaces fill the Herdr Space keys row-major, ordered by `number`, then `workspace_id`; keep surviving workspace IDs in their existing slots between polls so keys do not shuffle unnecessarily.
- Agent Summary, control keys and New Herdr Space may sit anywhere, including between space keys. They are not slots: the grid skips them and fills the next Herdr Space key.
- **The pager is dynamic and takes two keys.** While spaces fit the participating keys there is no pager: every key is a space tile and unused keys are black. With more spaces than keys, the last two keys become `←` and `→` pagers and the remaining keys page through the spaces.
- An external focus change reveals the page containing the newly focused workspace.
- None of the actions are available inside multi-actions.

## Key image language

Author each key at `144 × 144`, system sans text, flat geometry, no gradients, shadows, or decorative animation. Pictograms are inline SVG paths, never emoji, so they take the footer colour and look the same in the Elgato app, OpenDeck and the listing images.

**The whole tile background carries state.** No rings: the key lights up as a solid field of colour behind the text.

### Tile anatomy

- **Background:** state colour (see below). This is the primary signal, readable across a room.
- **Corner:** workspace number.
- **Centre:** the name exactly as Herdr presents it. Prefer `label`, then `terminal_title_stripped`, then the basename of `cwd`, then a shortened ID. One line, ellipsized.
- **Text budget — where it operates:** below the name, the repository directory name and `⎇ branch`, derived from the workspace's worktree checkout or its first pane's `cwd`. Omit lines that do not apply rather than shrinking type.
- **Footer:** one of
  - a literal lifecycle word (`IDLE`, `DONE`) when the background is plain, so state is never colour-only;
  - an activity row of pictograms and counts when the workspace has agent activity (below);
  - `FOCUSING…` or `FAILED · TRY AGAIN` after a press (see interactions).

### Status language

| State | Background | Text |
|-------|------------|------|
| focused / selected | green `#A6E3A1` | dark `#1E1E2E` |
| `working` | yellow `#F9E2AF` | dark `#1E1E2E` |
| `blocked` (needs input) | red `#F38BA8` | dark `#1E1E2E` |
| idle, but subagents or background tasks still running (activity) | blue `#89B4FA` | dark `#1E1E2E`; footer shows a pictogram and count per kind of work |
| `idle` / `done` / `unknown` — neither working nor focused | plain `#1E1E2E` | light `#CDD6F4`, footer carries the word |
| idle, only a scheduled check pending (activity) | near-black mauve `#362A52` | light `#CDD6F4`; footer shows the loop or clock pictogram and a countdown in mauve `#CBA6F7` (`17M`) |

Precedence: focused > blocked > working > background activity > scheduled check > plain. Use `#A6ADC8` for metadata text on plain tiles. Workspace keys use Herdr's aggregate `agent_status`; do not recompute it in the plugin.

### Agent activity (optional)

When the [herdr-agent-activity](https://github.com/Resilient-Software/herdr-agent-activity) plugin is installed, each workspace carries `rsact_*` metadata tokens (its [contract](https://github.com/Resilient-Software/herdr-agent-activity/blob/main/CONTRACT.md)) summing the subagents, background shells, monitors and scheduled checks of its agents. The deck reads them from the same snapshot and only ever *refines* Herdr's state:

- It never overrides focused, blocked or working; on those tiles the activity appears in the footer only.
- An idle workspace whose agents still have subagents or background tasks running is not finished, so it gets its own blue field.
- An idle workspace whose only activity is a scheduled check is waiting on a timer, not finished, so it gets a near-black mauve field with a mauve countdown footer; the countdown is computed locally from `rsact_next_at` and repainted every 15 s.
- **Fail open:** without the plugin, or with a token contract version the deck does not know, tiles render exactly as described above.

The activity footer is a row of pictograms, each followed by its count:

| Pictogram | Glyph | Shows |
|-----------|-------|-------|
| robot head | `subagents` | subagents running (`rsact_subagents`) |
| terminal window with a prompt | `shell` | background shells (`rsact_background`) |
| eye | `monitor` | monitors (`rsact_monitors`) |
| clockwise circular arrow | `loop` | time until a recurring scheduled check (`rsact_loop=1`) |
| clock face | `clock` | time until a one-shot scheduled check |

- **Counts first:** subagents, then shells, then monitors, at most three items. Each item is a 20-unit pictogram, a 2-unit gap and the count in 18 px bold; items sit 9 units apart, centred on the key, with the band centred at y = 124. Trailing items are dropped if the row would exceed 132 units.
- **Countdown only when there are no counts:** the `loop` glyph for a recurring check, otherwise `clock`, followed by the time left: `45S`, `17M`, `2H`, `NOW`.
- **Colour:** dark `#1E1E2E` on the light fields (green, yellow, red, blue), mauve `#CBA6F7` on the mauve field.
- Lifecycle words, `FOCUSING…` and `FAILED · TRY AGAIN` stay 13 px text.

Working is a static yellow field; any motion experiment comes later and must not reduce legibility.

### Pager keys (dynamic)

Pagers exist only while spaces exceed the participating keys. They are controls, not data tiles:

- Two keys: a large `←` and a large `→` arrow, each with the `<current>/<total>` page indicator below.
- Press moves one page in that direction; no wrap and no auto-repeat.
- If the focused space is off the visible page, the arrow pointing toward it is accented.
- When the space count fits the keys again, both pager keys return to being space tiles.

## Agent Summary

One key that counts workspaces by state, so the sum answers "how many are really finished?".

Each workspace is counted once, in the first state that applies: blocked, working, busy in the background (activity other than a lone scheduled check), scheduled, done, idle. A workspace where Herdr reports `unknown` and no pane runs an agent is not counted. The summary has no focused colour; it counts agent state only.

| State | Colour | List word |
|-------|--------|-----------|
| blocked | red `#F38BA8` | `BLOCKED` |
| working | yellow `#F9E2AF` | `WORKING` |
| background activity | blue `#89B4FA` | `BUSY` |
| scheduled check | mauve `#CBA6F7` | `TIMER` |
| done | teal `#94E2D5` | `DONE` |
| idle | overlay `#6C7086` | `IDLE` |

States always appear in that order. The key has two looks, chosen in the property inspector:

- **Ring** (default): a donut of proportional segments on the plain background (a grey ring when nothing is counted), with the total in the centre. The footer names what matters most: `2 BLOCKED` in red; else `1 DONE` in teal; else, with a scheduled check pending, the loop or clock pictogram and the soonest countdown; else `ALL BUSY`; with nothing counted, `NO AGENTS`.
- **List:** one row per non-zero state — a colour swatch, the count and the state word. With nothing counted the key shows `NO AGENTS`.

**Press** focuses the workspace that needs you most and raises the hosting application, exactly like a space tile, with `FOCUSING…` and `FAILED · TRY AGAIN` in the summary's footer. The order is blocked, then done, then idle, each by workspace number, skipping the workspace that is already focused. With nothing waiting, the footer flashes `ALL CLEAR`.

## Control keys

Five actions act on a target through Herdr. Each one shows a small uppercase caption at the top left, a large value in the centre, and in the footer where a press will go (New Tab shows the folder it will open):

| Action | Settings | Press sends | Face |
|--------|----------|-------------|------|
| Slash Command | command, e.g. `/review` | the command, then Enter | `COMMAND`, `/review` |
| Send Text | text; "press Enter" (on by default) | the text, then Enter unless turned off | `TEXT`, first line of the text |
| Send Keys | keys, default `esc` | the key presses | `KEYS`, the keys separated by spaces |
| Cycle | command, e.g. `/model`; values, e.g. `opus, sonnet, haiku` | `<command> <next value>`, then Enter | the command (or `CYCLE`), the value the next press sends |
| New Tab | folder (empty means the target pane's folder) | opens a tab in the target workspace | `NEW TAB`, a green `+`; footer is the folder's name |

The value is blue (green for New Tab), sized to fit and truncated with `…` when long. A Slash Command with no command shows `—` and `NOT SET`.

### Targeting

Every control key has a target setting: **Focused agent** (the default) or a **pinned workspace** picked from a list of the current workspaces.

- **Focused agent:** Herdr's focused workspace and its focused pane. If that pane runs no agent but exactly one other pane in the workspace does, the key targets that agent instead. Footer: `> api-server`.
- **Pinned workspace:** the focused pane of the workspace's active tab, else its first pane, with the same agent rule. Footer: `#2 webapp`.
- A pinned key stores the workspace's ID and its name. While the plugin watches that ID without a gap in the connection, the pin follows it and keeps the saved name current, so a name that changes with the working directory does not break it. After a gap (Herdr may have restarted, and it reuses workspace IDs) the pin holds only if the ID still belongs to a workspace with that name. If the ID is gone or now names a different workspace, but exactly one workspace has the pinned name as its label, the key re-pins to it and saves the new ID; names derived from a workspace's number never re-pin. Otherwise the key shows `GONE`, dims, and a press does nothing. A pin saved without a name matches by ID alone.
- With no focused workspace the footer shows `NO AGENT`, the key dims, and a press does nothing.

The footer always shows where a press will go before it is pressed.

### Sending

| Target | Enter on | Enter off |
|--------|----------|-----------|
| pane runs an agent | `agent.prompt`: Herdr pastes the text, then presses Enter | `pane.send_text` |
| plain shell | `pane.send_input`: text and Enter in one write | `pane.send_text` |

Send Keys uses `pane.send_keys`; New Tab uses `tab.create` with focus, then raises the hosting application. Each call goes over the socket with the same per-call CLI fallback as focus and create. Text is appended to whatever is already typed in the pane; the deck does not clear a draft first.

- **Blocked agents:** Slash Command, Send Text and Cycle never type into an agent waiting at a permission prompt; the key flashes `BLOCKED` and sends nothing. Herdr itself also refuses `agent.prompt` to a blocked agent. Send Keys always sends, so `esc` can dismiss a prompt or interrupt a run.
- **Send Keys** takes names separated by commas or spaces: `esc`/`escape`, `enter`/`return`, `tab`, `space`, `backspace`, `up`, `down`, `left`, `right`, `f1`–`f12`, or `ctrl+`, `control+`, `alt+`, `meta+`, `option+` or `shift+` followed by one of those names or a single character (`ctrl+c`, `shift+tab`, `alt+enter`). Names are case-insensitive (`Ctrl+C` becomes `ctrl+c`); a single character is sent as typed, so `A` stays `A`. Anything else (`home`, `S-Tab`) makes the face show `BAD KEY` in red, and a press sends nothing.
- **Cycle** splits its values on commas or new lines. Each press sends the command and the next value (just the value when the command is empty), then advances, wrapping from the last value to the first. The position is saved in the key's settings, so it survives restarts, and fast presses each send the next value. The key shows what it will send; it does not read back what the agent actually uses.
- **New Tab** checks a configured folder first: if it does not exist the key flashes `NO SUCH DIR` and opens nothing.

**Flashes.** After a press the footer shows the result for about a second: green `SENT` or `OPENED`; red `BLOCKED`, `NOT READY` (the agent has exited or is no longer the pane's foreground process), `BAD KEY`, `NO SUCH DIR`, `NOT SET`, `GONE` (the pane closed) or `FAILED`. Then the live face returns. Do not use the host's generic alert overlay.

**One send at a time.** Presses are sent in order, each after the previous one finishes: Herdr writes a prompt's Enter shortly after its text, so overlapping prompts would interleave in the agent's input.

## Interaction vocabulary

| Key | Press | Long press |
|-----|-------|------------|
| Space | Focus workspace in Herdr **and raise the application hosting the Herdr client** (e.g. the terminal it runs in) | Same as press; no hidden alternate action |
| Pager `←` / `→` (only when present) | One page in that direction | Same as press |
| New Herdr Space | Create a workspace (`herdr workspace create --focus`) and raise the hosting application | Same as press |
| Agent Summary | Focus the workspace that needs you most (blocked, then done, then idle; never the focused one) and raise the hosting application; `ALL CLEAR` when none | Same as press |
| Slash Command | Send the command and Enter to the target | Same as press |
| Send Text | Send the text to the target, with Enter unless turned off | Same as press |
| Send Keys | Send the key presses to the target, even to a blocked agent | Same as press |
| Cycle | Send the command and the next value with Enter, then advance | Same as press |
| New Tab | Open a tab in the target workspace, in the target pane's folder or the configured one; focus it and raise the hosting application | Same as press |
| Empty key | No-op | No-op |
| Key without the action | Never touched | Never touched |

The New Herdr Space key renders as a green `+` with `NEW SPACE` below; it dims and goes inert while Herdr is offline.

- Every key acts exactly once on key-up. Holding it must not create a second action, and a key-up without a preceding key-down is ignored.
- Pager keys move one page in their direction. Do not auto-repeat or wrap at either end.
- Key-down adds immediate pressed feedback. After a focus request, render `FOCUSING…` in the footer until the snapshot confirms it (the background does not turn green until confirmed). On command failure, render `FAILED · TRY AGAIN` in red for one second, then restore live state. Do not use the host's generic alert overlay.
- Keep gesture state per key context; cancel timers on disappearance or disconnect.

## Overflow and live updates

- Without a pager, all 14 keys are space tiles. With a pager, pages contain 13 spaces.
- A manual page change is view-only and persists until the user focuses an item or Herdr's focused ID changes externally.
- Additions fill the first free position after existing IDs. Removals compact; clamp the page only when its old index no longer exists.
- Track the session over the herdr server socket: an `events.subscribe` stream triggers a debounced snapshot refresh (75 ms coalesce, at most one refresh per 300 ms — the server replays an event backlog to fresh subscribers), with a 5 s reconciliation poll while the stream is live. `pane_updated` events that change no deck-visible field (output-revision churn while an agent streams) are dropped before they trigger anything. The snapshot stays authoritative; event payloads are never applied directly.
- Without the socket (socket moved, subscribe refused), fall back to polling the snapshot at 1 Hz via the CLI and retry the subscription with exponential backoff (1 s doubling to a 15 s cap; reset on success). Redraw only keys whose image model changed in either mode.
- Commands fall back to the CLI only when the socket itself fails. An error Herdr returns (a blocked agent, an unknown pane) is final for that press.
- The pager, when present, always occupies the bottom-right key; never reinterpret a space tile as navigation.
- Countdowns on space tiles and the summary repaint every 15 s.

## Empty, loading, and offline states

- **Starting:** top-left shows `HERDR · CONNECTING`; every other usable key is black. The summary shows `CONNECTING` and control keys are dim; both are inert until the first snapshot.
- **Online, no workspaces:** top-left shows `NO SPACES · OPEN HERDR`; all other data keys are black and pagers show `0`.
- **Unused positions:** fully black and inert; do not show fake slot numbers or plus buttons.
- **Transient poll failure:** keep the last good frame for two failed polls to avoid flicker.
- **Offline after three failures:** freeze and dim last-known labels on plain backgrounds, disable all focus and page actions, and show `HERDR OFFLINE` in red text on the top-left key. Summary and control keys dim and go inert, presses send nothing, and the summary does not keep showing stale counts. Recover automatically on the next valid snapshot.

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

### Stage 3.5 — socket transport (built)

Replace the 1 Hz CLI poll as the primary update path: talk to the herdr server socket directly (newline-delimited JSON request/response plus a dedicated `events.subscribe` stream), refresh on relevant events, and keep the CLI poll as an automatic fallback. Focus and create commands go over the socket too, with the same CLI fallback per call.

### 1.0 — summary and agent controls

- Agent activity tiles (blue background work, mauve scheduled checks) with pictogram footers.
- Agent Summary key with ring and list looks.
- Control keys: Slash Command, Send Text, Send Keys, Cycle and New Tab, targeting the focused agent or a pinned workspace.
- Property inspectors for every action, an end-to-end harness against a sandbox Herdr server, and a Herdr floor of 0.8.2.

### Stage 4 — device polish

Calibrate type, colours, brightness, and acknowledgement timing on a physical MK.2. Add working-state motion only if it remains legible and does not disturb live updates. Ship the OpenDeck profile/install path after a full reconnect, hot-plug, overflow, and offline recovery pass.

## Non-goals

- No answer or approve presets for permission prompts. Send Text types whatever the user configures, but the plugin ships no key that says yes on the user's behalf.
- No Stream Deck+ dials or touch strip.
- No automatic launching of Herdr.
- No optimistic focus state; the snapshot is authoritative.
- No touching keys the user has not placed an action on, under any circumstance.
