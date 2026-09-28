import { describe, expect, test } from "vitest";

import { activityFooter, countdown, parseActivity } from "../src/activity";
import type { Workspace } from "../src/herdr";
import { spaceTile } from "../src/render";

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

function space(overrides: Partial<Workspace>): Workspace {
	return {
		workspace_id: "w1",
		number: 1,
		label: "gram",
		agent_status: "idle",
		pane_count: 1,
		tab_count: 1,
		focused: false,
		worktree: null,
		...overrides,
	};
}

function svg(image: string): string {
	return Buffer.from(image.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
}

function background(image: string): string | null {
	return /<rect width="144" height="144" fill="(#[0-9a-f]+)"/.exec(svg(image))?.[1] ?? null;
}

function footer(image: string): string | null {
	return /<text x="72" y="132" fill="(#[0-9a-f]+)"[^>]*>([^<]*)<\/text>/.exec(svg(image))?.slice(1).join(" ") ?? null;
}

const INFO = { repo: "gram", branch: "main" };
const BG = { rsact_v: "1", rsact_state: "background", rsact_subagents: "2", rsact_background: "1" };
const LOOP = {
	rsact_v: "1",
	rsact_state: "scheduled",
	rsact_next_at: new Date(NOW + 4 * 60_000).toISOString(),
	rsact_loop: "1",
};

describe("parseActivity", () => {
	test("fails open without tokens or with another contract version", () => {
		expect(parseActivity(undefined)).toBeNull();
		expect(parseActivity({})).toBeNull();
		expect(parseActivity({ rsact_v: "2", rsact_state: "background" })).toBeNull();
		expect(parseActivity({ rsact_v: "1" })).toBeNull();
	});

	test("reads counts and schedules; unknown states count as background", () => {
		expect(parseActivity(BG)).toEqual({ state: "background", subagents: 2, background: 1, monitors: 0, nextAt: null, loop: false });
		expect(parseActivity(LOOP)?.nextAt).toBe(NOW + 4 * 60_000);
		expect(parseActivity({ rsact_v: "1", rsact_state: "future" })?.state).toBe("background");
	});
});

describe("footer text", () => {
	test("countdown units", () => {
		expect(countdown(NOW - 1, NOW)).toBe("NOW");
		expect(countdown(NOW + 45_000, NOW)).toBe("IN 45S");
		expect(countdown(NOW + 4 * 60_000, NOW)).toBe("IN 4M");
		expect(countdown(NOW + 3 * 3_600_000, NOW)).toBe("IN 3H");
		expect(countdown(NOW + 3 * 86_400_000, NOW)).toBe("IN 3D");
	});

	test("dominant activity first, at most two parts, schedule only when nothing runs", () => {
		const activity = parseActivity({ ...BG, rsact_monitors: "1", rsact_next_at: LOOP.rsact_next_at });
		expect(activityFooter(activity!, NOW)).toBe("2 SUB · 1 BG");
		expect(activityFooter(parseActivity(LOOP)!, NOW)).toBe("LOOP IN 4M");
	});
});

describe("spaceTile with activity", () => {
	test("without the plugin tiles render exactly as before", () => {
		const image = spaceTile(space({ agent_status: "idle" }), INFO, { now: NOW });
		expect(background(image)).toBeNull();
		expect(footer(image)).toBe("#a6adc8 IDLE");
	});

	test("idle with running subagents or background tasks lights blue and says what runs", () => {
		const image = spaceTile(space({ agent_status: "idle", tokens: BG }), INFO, { now: NOW });
		expect(background(image)).toBe("#89b4fa");
		expect(footer(image)).toBe("#313244 2 SUB · 1 BG");
	});

	test("scheduled checks light mauve with a countdown", () => {
		const image = spaceTile(space({ agent_status: "done", tokens: LOOP }), INFO, { now: NOW });
		expect(background(image)).toBe("#cba6f7");
		expect(footer(image)).toBe("#313244 LOOP IN 4M");
	});

	test("herdr's own state keeps precedence: blocked, working and focus are never hidden", () => {
		expect(background(spaceTile(space({ agent_status: "blocked", tokens: BG }), INFO, { now: NOW }))).toBe("#f38ba8");
		const working = spaceTile(space({ agent_status: "working", tokens: BG }), INFO, { now: NOW });
		expect(background(working)).toBe("#f9e2af");
		expect(footer(working)).toBe("#313244 2 SUB · 1 BG");
		expect(background(spaceTile(space({ focused: true, tokens: BG }), INFO, { now: NOW }))).toBe("#a6e3a1");
	});

	test("focus feedback footers win over activity", () => {
		const image = spaceTile(space({ tokens: BG }), INFO, { now: NOW, footer: "FOCUSING…" });
		expect(footer(image)).toBe("#313244 FOCUSING…");
	});

	test("offline tiles stay dim and ignore activity", () => {
		const image = spaceTile(space({ tokens: BG }), INFO, { now: NOW, dim: true });
		expect(background(image)).toBeNull();
		expect(footer(image)).toBeNull();
	});
});
