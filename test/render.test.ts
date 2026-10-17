import { describe, expect, test } from "vitest";

import type { Workspace } from "../src/herdr";
import {
	connectingTile,
	controlTile,
	emptyTile,
	infobarImage,
	newSpaceTile,
	noSpacesTile,
	offlineTile,
	pagerTile,
	spaceTile,
	summaryTile,
} from "../src/render";
import type { Counts } from "../src/state";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

function svg(image: string): string {
	return Buffer.from(image.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
}

function counts(overrides: Partial<Counts>): Counts {
	const base: Counts = {
		blocked: 0,
		working: 0,
		background: 0,
		scheduled: 0,
		done: 0,
		idle: 0,
		total: 0,
		nextAt: null,
		loop: false,
		...overrides,
	};
	if (overrides.total === undefined) {
		base.total = base.blocked + base.working + base.background + base.scheduled + base.done + base.idle;
	}
	return base;
}

function space(overrides: Partial<Workspace>): Workspace {
	return {
		workspace_id: "w1",
		number: 1,
		label: "api-server",
		agent_status: "idle",
		pane_count: 1,
		tab_count: 1,
		focused: false,
		worktree: null,
		...overrides,
	};
}

describe("summaryTile", () => {
	test("ring counts the total and calls out blocked agents in red", () => {
		const out = svg(summaryTile(counts({ blocked: 2, working: 3, idle: 1 }), "ring"));
		expect(out).toContain(">6</text>");
		expect(out).toMatch(/fill="#f38ba8"[^>]*>2 BLOCKED</);
		expect(out.match(/<path d="M/g)).toHaveLength(3);
	});

	test("ring falls back to done, then the soonest check, then busy", () => {
		expect(svg(summaryTile(counts({ done: 2, working: 1 }), "ring"))).toMatch(/fill="#94e2d5"[^>]*>2 DONE</);
		const scheduled = svg(summaryTile(counts({ scheduled: 1, nextAt: NOW + 17 * 60_000, loop: true }), "ring", { now: NOW }));
		expect(scheduled).toContain('fill="#cba6f7"');
		expect(scheduled).toContain(">17M</text>");
		expect(svg(summaryTile(counts({ working: 2 }), "ring"))).toContain(">ALL BUSY<");
		expect(svg(summaryTile(counts({}), "ring"))).toContain(">NO AGENTS<");
	});

	test("one state draws a whole circle", () => {
		const out = svg(summaryTile(counts({ working: 4 }), "ring"));
		expect(out).toContain('<circle cx="72" cy="62" r="40" fill="none" stroke="#f9e2af"');
	});

	test("list shows only states present, in priority order", () => {
		const out = svg(summaryTile(counts({ idle: 1, blocked: 2 }), "list"));
		expect(out).not.toContain("WORKING");
		expect(out.indexOf("BLOCKED")).toBeLessThan(out.indexOf("IDLE"));
		expect(svg(summaryTile(counts({}), "list"))).toContain(">NO AGENTS<");
	});

	test("without counts there are no numbers, only the footer", () => {
		const out = svg(summaryTile(null, "list", { dim: true, footer: "OFFLINE", footerRed: true }));
		expect(out).toContain('opacity="0.45"');
		expect(out).toMatch(/fill="#f38ba8"[^>]*>OFFLINE</);
		expect(out).not.toMatch(/>\d+<\/text>/);
	});
});

describe("infobarImage", () => {
	test("is drawn on the 232 × 50 Infobar canvas with a cell per state present", () => {
		const out = svg(infobarImage(counts({ blocked: 1, working: 2, done: 1 })));
		expect(out).toContain('viewBox="0 0 232 50"');
		expect(out).toContain(">4</text>");
		expect(out.match(/<rect /g)).toHaveLength(3);
	});

	test("shows a message instead of counts while offline", () => {
		const out = svg(infobarImage(null, { dim: true, message: "OFFLINE" }));
		expect(out).toContain(">OFFLINE<");
		expect(out).not.toContain("AGENTS");
	});
});

describe("controlTile", () => {
	test("shows caption, value and target", () => {
		const out = svg(controlTile({ caption: "command", value: "/review", footer: "> api-server", tone: "blue" }));
		expect(out).toContain(">COMMAND<");
		expect(out).toMatch(/fill="#89b4fa"[^>]*>\/review</);
		expect(out).toContain(">&gt; api-server<");
	});

	test("long values wrap at a space, or truncate", () => {
		const wrapped = svg(controlTile({ caption: "text", value: "please continue with the plan", footer: "", tone: "blue" }));
		expect(wrapped).toContain(">please<");
		const long = svg(controlTile({ caption: "text", value: "x".repeat(30), footer: "", tone: "blue" }));
		expect(long).toContain(`>${"x".repeat(12)}…<`);
	});

	test("dims the face but keeps the footer readable, and flashes the result", () => {
		const out = svg(controlTile({ caption: "keys", value: "esc", footer: "GONE", tone: "blue", dim: true }));
		expect(out).toMatch(/<g opacity="0.45">.*esc.*<\/g><text[^>]*>GONE</);
		expect(svg(controlTile({ caption: "keys", value: "esc", footer: "", tone: "blue", flash: { text: "SENT", ok: true } }))).toMatch(
			/fill="#a6e3a1"[^>]*>SENT</,
		);
		expect(svg(controlTile({ caption: "keys", value: "esc", footer: "", tone: "blue", flash: { text: "BLOCKED", ok: false } }))).toMatch(
			/fill="#f38ba8"[^>]*>BLOCKED</,
		);
	});
});

describe("every key image", () => {
	test("uses no emoji or symbol characters that hosts render differently", () => {
		const activity = { rsact_v: "1", rsact_state: "subagents", rsact_subagents: "2", rsact_background: "1", rsact_monitors: "1" };
		const images = [
			spaceTile(space({ tokens: activity }), { repo: "backend", branch: "main" }, { now: NOW }),
			spaceTile(space({ focused: true }), { repo: "backend", branch: "main" }, { footer: "FOCUSING…" }),
			summaryTile(counts({ blocked: 1, scheduled: 1, nextAt: NOW + 60_000 }), "ring", { now: NOW }),
			summaryTile(counts({ blocked: 1, done: 2 }), "list"),
			infobarImage(counts({ working: 1 })),
			controlTile({ caption: "cycle", value: "opus", footer: "#2 webapp", tone: "blue" }),
			pagerTile(true, 1, 2, true, false),
			newSpaceTile(false),
			emptyTile(),
			connectingTile(),
			noSpacesTile(),
			offlineTile(),
		];
		for (const image of images) {
			for (const char of svg(image)) {
				expect(char.codePointAt(0)!).toBeLessThan(0x3000);
			}
		}
	});
});
