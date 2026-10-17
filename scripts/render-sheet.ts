/**
 * Writes every key image variant as an SVG under dist/sheet/, for eyeballing
 * at real key size. Rasterise and tile them with scripts/render-sheet.sh.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

import type { Workspace } from "../src/herdr";
import {
	connectingTile,
	controlTile,
	emptyTile,
	newSpaceTile,
	offlineTile,
	pagerTile,
	spaceTile,
	summaryTile,
} from "../src/render";
import type { Counts } from "../src/state";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const OUT = "dist/sheet";

function space(number: number, label: string, overrides: Partial<Workspace> = {}): Workspace {
	return {
		workspace_id: `w${number}`,
		number,
		label,
		agent_status: "idle",
		pane_count: 1,
		tab_count: 1,
		focused: false,
		worktree: null,
		...overrides,
	};
}

function counts(c: Partial<Counts>): Counts {
	const all: Counts = { blocked: 0, working: 0, background: 0, scheduled: 0, done: 0, idle: 0, total: 0, nextAt: null, loop: false, ...c };
	all.total = all.blocked + all.working + all.background + all.scheduled + all.done + all.idle;
	return all;
}

const tokens = (extra: Record<string, string>) => ({ rsact_v: "1", ...extra });
const info = { repo: "backend", branch: "feat/login" };
const soon = new Date(NOW + 17 * 60_000).toISOString();

const keys: Record<string, string> = {
	"space-focused": spaceTile(space(1, "api-server", { focused: true }), info, { now: NOW }),
	"space-working": spaceTile(space(2, "refactor", { agent_status: "working" }), info, { now: NOW }),
	"space-blocked": spaceTile(space(3, "migration", { agent_status: "blocked" }), info, { now: NOW }),
	"space-busy-1": spaceTile(space(4, "tests", { tokens: tokens({ rsact_state: "subagents", rsact_subagents: "2" }) }), info, { now: NOW }),
	"space-busy-2": spaceTile(
		space(5, "docs-gen", { tokens: tokens({ rsact_state: "background", rsact_subagents: "2", rsact_background: "1" }) }),
		info,
		{ now: NOW },
	),
	"space-busy-3": spaceTile(
		space(6, "infra", {
			agent_status: "working",
			tokens: tokens({ rsact_state: "subagents", rsact_subagents: "12", rsact_background: "3", rsact_monitors: "2" }),
		}),
		info,
		{ now: NOW },
	),
	"space-loop": spaceTile(space(7, "nightly", { tokens: tokens({ rsact_state: "scheduled", rsact_next_at: soon, rsact_loop: "1" }) }), info, {
		now: NOW,
	}),
	"space-once": spaceTile(
		space(8, "deploy", { tokens: tokens({ rsact_state: "scheduled", rsact_next_at: new Date(NOW + 2 * 3_600_000).toISOString() }) }),
		info,
		{ now: NOW },
	),
	"space-idle": spaceTile(space(9, "docs"), info, { now: NOW }),
	"space-done": spaceTile(space(10, "webapp", { agent_status: "done" }), info, { now: NOW }),
	"space-focusing": spaceTile(space(11, "api-server"), info, { footer: "FOCUSING…" }),
	"space-failed": spaceTile(space(12, "api-server"), info, { footer: "FAILED · TRY AGAIN", footerRed: true }),
	"space-offline": spaceTile(space(13, "api-server"), info, { dim: true }),
	"summary-ring-blocked": summaryTile(counts({ blocked: 2, working: 3, background: 1, scheduled: 1, done: 1, idle: 1 }), "ring"),
	"summary-ring-done": summaryTile(counts({ working: 2, done: 3 }), "ring"),
	"summary-ring-timer": summaryTile(counts({ working: 1, scheduled: 2, nextAt: NOW + 17 * 60_000, loop: true }), "ring", { now: NOW }),
	"summary-ring-busy": summaryTile(counts({ working: 4 }), "ring"),
	"summary-ring-empty": summaryTile(counts({}), "ring"),
	"summary-ring-focusing": summaryTile(counts({ blocked: 1, working: 1 }), "ring", { footer: "FOCUSING…" }),
	"summary-list-all": summaryTile(counts({ blocked: 2, working: 3, background: 1, scheduled: 1, done: 12, idle: 1 }), "list"),
	"summary-list-two": summaryTile(counts({ blocked: 1, idle: 4 }), "list"),
	"summary-offline": summaryTile(null, "ring", { dim: true, footer: "OFFLINE", footerRed: true }),
	"control-command": controlTile({ caption: "command", value: "/review", footer: "> api-server", tone: "blue" }),
	"control-text": controlTile({ caption: "text", value: "go ahead", footer: "> api-server", tone: "blue" }),
	"control-text-long": controlTile({ caption: "text", value: "please continue with the plan", footer: "#2 webapp", tone: "blue" }),
	"control-keys": controlTile({ caption: "keys", value: "esc", footer: "> api-server", tone: "blue" }),
	"control-keys-bad": controlTile({ caption: "keys", value: "S-Tab", footer: "BAD KEY", tone: "blue", dim: true }),
	"control-cycle": controlTile({ caption: "/model", value: "opus", footer: "> api-server", tone: "blue" }),
	"control-newtab": controlTile({ caption: "new tab", value: "+", footer: "backend", tone: "green" }),
	"control-gone": controlTile({ caption: "command", value: "/review", footer: "GONE", tone: "blue", dim: true }),
	"control-sent": controlTile({ caption: "command", value: "/review", footer: "", tone: "blue", flash: { text: "SENT", ok: true } }),
	"control-blocked": controlTile({ caption: "text", value: "go ahead", footer: "", tone: "blue", flash: { text: "BLOCKED", ok: false } }),
	"pager-left": pagerTile(true, 1, 3, false, false),
	"pager-right": pagerTile(false, 1, 3, true, false),
	"new-space": newSpaceTile(false),
	empty: emptyTile(),
	connecting: connectingTile(),
	offline: offlineTile(),
};

function decode(image: string): string {
	return Buffer.from(image.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/keys`, { recursive: true });
for (const [name, image] of Object.entries(keys)) {
	writeFileSync(`${OUT}/keys/${name}.svg`, decode(image));
}
console.log(`wrote ${Object.keys(keys).length} keys to ${OUT}/`);
