/**
 * Generates Marketplace listing media (thumbnail and gallery) as SVGs under
 * dist/media/, composing the plugin's real renderers so the shots match
 * what ships. Render to PNG with scripts/gen-media.sh (needs rsvg-convert).
 */
import { mkdirSync, writeFileSync } from "node:fs";

import type { GitInfo, Workspace } from "../src/herdr";
import { controlTile, newSpaceTile, pagerTile, spaceTile, summaryTile } from "../src/render";
import type { Counts } from "../src/state";

const BG = "#11111b";
const DEVICE = "#181825";
const TEXT = "#cdd6f4";
const SUBTEXT = "#a6adc8";
const BORDER = "#313244";
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

let clipSeq = 0;

function decode(dataUrl: string): string {
	return Buffer.from(dataUrl.replace("data:image/svg+xml;base64,", ""), "base64").toString();
}

/** Places a rendered image at (x, y), scaled to width w, clipped to rounded corners. */
function embed(dataUrl: string, x: number, y: number, w: number, radius = 16): string {
	const svg = decode(dataUrl);
	const [, vw, vh] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? ["", "144", "144"];
	const scale = w / Number(vw);
	const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
	const id = `clip${clipSeq++}`;
	return (
		`<g transform="translate(${x} ${y}) scale(${scale})">` +
		`<clipPath id="${id}"><rect width="${vw}" height="${vh}" rx="${radius}"/></clipPath>` +
		`<rect width="${vw}" height="${vh}" rx="${radius}" fill="#000"/>` +
		`<g clip-path="url(#${id})">${inner}</g>` +
		`<rect width="${vw}" height="${vh}" rx="${radius}" fill="none" stroke="${BORDER}" stroke-width="3"/>` +
		`</g>`
	);
}

function text(value: string, x: number, y: number, size: number, color: string, weight = 600, anchor = "middle"): string {
	return `<text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${value}</text>`;
}

function lines(values: string[], x: number, y: number, size: number, color: string, anchor = "start", weight = 400): string {
	return values.map((value, i) => text(value, x, y + i * size * 1.35, size, color, weight, anchor)).join("");
}

function canvas(body: string): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="960" viewBox="0 0 1920 960">` +
		`<rect width="1920" height="960" fill="${BG}"/>` +
		body +
		`</svg>`
	);
}

/** A device body holding a grid of rendered keys, row-major. */
function deck(keys: (string | null)[], columns: number, x: number, y: number, size: number, gap: number): string {
	const rows = Math.ceil(keys.length / columns);
	const pad = gap * 1.6;
	const width = columns * size + (columns - 1) * gap + pad * 2;
	const height = rows * size + (rows - 1) * gap + pad * 2;
	let svg = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${pad}" fill="${DEVICE}" stroke="${BORDER}" stroke-width="2"/>`;
	keys.forEach((key, i) => {
		const kx = x + pad + (i % columns) * (size + gap);
		const ky = y + pad + Math.floor(i / columns) * (size + gap);
		svg += key ? embed(key, kx, ky, size) : `<rect x="${kx}" y="${ky}" width="${size}" height="${size}" rx="${size / 9}" fill="#000" stroke="${BORDER}" stroke-width="2"/>`;
	});
	return svg;
}

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

const git = (repo: string, branch: string): GitInfo => ({ repo, branch });
const busyTokens = { rsact_v: "1", rsact_state: "background", rsact_subagents: "2", rsact_background: "1" };
const loopTokens = { rsact_v: "1", rsact_state: "scheduled", rsact_loop: "1", rsact_next_at: new Date(NOW + 17 * 60_000).toISOString() };

const tiles = {
	focused: spaceTile(space(1, "api-server", { focused: true }), git("backend", "main"), { now: NOW }),
	working: spaceTile(space(2, "refactor", { agent_status: "working" }), git("webapp", "feat/nav"), { now: NOW }),
	blocked: spaceTile(space(3, "migration", { agent_status: "blocked" }), git("infra", "db-move"), { now: NOW }),
	busy: spaceTile(space(4, "tests", { tokens: busyTokens }), git("backend", "ci"), { now: NOW }),
	loop: spaceTile(space(5, "nightly", { tokens: loopTokens }), git("ops", "main"), { now: NOW }),
	idle: spaceTile(space(6, "docs"), git("handbook", "main"), { now: NOW }),
	done: spaceTile(space(7, "webapp", { agent_status: "done" }), git("webapp", "fix/login"), { now: NOW }),
};
const mix = counts({ blocked: 1, working: 1, background: 1, scheduled: 1, done: 1, idle: 1, nextAt: NOW + 17 * 60_000, loop: true });
const controls = {
	command: controlTile({ caption: "command", value: "/review", footer: "> api-server", tone: "blue" }),
	text: controlTile({ caption: "text", value: "go ahead", footer: "> api-server", tone: "blue" }),
	keys: controlTile({ caption: "keys", value: "esc", footer: "> api-server", tone: "blue" }),
	cycle: controlTile({ caption: "/model", value: "opus", footer: "> api-server", tone: "blue" }),
	newTab: controlTile({ caption: "new tab", value: "+", footer: "backend", tone: "green" }),
	pinned: controlTile({ caption: "text", value: "run the tests", footer: "#2 refactor", tone: "blue" }),
	sent: controlTile({ caption: "command", value: "/review", footer: "", tone: "blue", flash: { text: "SENT", ok: true } }),
};

const heroDeck = deck(
	[
		tiles.focused,
		tiles.working,
		tiles.blocked,
		tiles.busy,
		summaryTile(mix, "ring", { now: NOW }),
		tiles.loop,
		tiles.idle,
		tiles.done,
		pagerTile(true, 1, 2, false, false),
		pagerTile(false, 1, 2, false, false),
		controls.command,
		controls.text,
		controls.keys,
		controls.cycle,
		controls.newTab,
	],
	5,
	900,
	193,
	150,
	22,
);

const hero = canvas(
	text("Herdr Deck", 110, 400, 104, TEXT, 700, "start") +
		lines(["Every coding agent,", "live on your keys."], 114, 490, 46, SUBTEXT) +
		lines(["Know which agents are busy, blocked or", "really done, and drive them from the deck."], 114, 660, 30, SUBTEXT) +
		heroDeck,
);

const idle = canvas(
	text("Idle isn't always done", 960, 130, 76, TEXT, 700) +
		text("Agents go quiet while subagents, background shells or a scheduled loop keep running.", 960, 196, 34, SUBTEXT, 400) +
		embed(tiles.done, 200, 290, 400) +
		embed(tiles.busy, 760, 290, 400) +
		embed(tiles.loop, 1320, 290, 400) +
		text("Finished", 400, 760, 38, TEXT, 700) +
		lines(["A plain key really", "means done"], 400, 815, 30, SUBTEXT, "middle") +
		text("Still busy", 960, 760, 38, TEXT, 700) +
		lines(["2 subagents and", "1 background shell running"], 960, 815, 30, SUBTEXT, "middle") +
		text("Waiting on a loop", 1520, 760, 38, TEXT, 700) +
		lines(["Next check in", "17 minutes"], 1520, 815, 30, SUBTEXT, "middle"),
);

const legend = [
	[tiles.focused, "Focused"],
	[tiles.working, "Working"],
	[tiles.blocked, "Needs you"],
	[tiles.busy, "Busy in background"],
	[tiles.loop, "Waiting on a timer"],
	[tiles.idle, "Idle or done"],
] as const;
const states = canvas(
	text("Read it from across the room", 960, 140, 76, TEXT, 700) +
		text("The whole key lights up with the agent's state.", 960, 206, 34, SUBTEXT, 400) +
		legend.map(([tile, label], i) => embed(tile, 115 + i * 290, 330, 250) + text(label, 115 + i * 290 + 125, 640, 28, TEXT, 600)).join("") +
		text("Name, repository and branch on every key.", 960, 790, 30, SUBTEXT, 400),
);

const summaryMix = counts({ blocked: 2, working: 3, background: 1, scheduled: 1, done: 1, idle: 1 });
const summary = canvas(
	text("See what needs you", 960, 130, 76, TEXT, 700) +
		text("Agent Summary counts every agent by state. Press it to jump to the one that needs you, blocked first.", 960, 196, 30, SUBTEXT, 400) +
		embed(summaryTile(summaryMix, "ring"), 170, 320, 400) +
		embed(summaryTile(summaryMix, "list"), 760, 320, 400) +
		text("→", 1270, 560, 90, SUBTEXT, 700) +
		embed(tiles.blocked, 1350, 320, 400) +
		text("Ring", 370, 790, 32, TEXT, 600) +
		text("List", 960, 790, 32, TEXT, 600) +
		text("Press: jumps to the blocked agent", 1550, 790, 32, TEXT, 600),
);

const controlKeys = [
	[controls.command, "Slash command"],
	[controls.text, "Phrase"],
	[controls.keys, "Key presses"],
	[controls.cycle, "Cycle values"],
	[controls.newTab, "New tab"],
	[controls.pinned, "Pinned to #2"],
] as const;
const drive = canvas(
	text("Drive agents from the deck", 960, 130, 76, TEXT, 700) +
		text("Send a command, a phrase or key presses to the agent you're focused on, or pin a key to a workspace.", 960, 196, 30, SUBTEXT, 400) +
		controlKeys.map(([tile, label], i) => embed(tile, 115 + i * 290, 330, 250) + text(label, 115 + i * 290 + 125, 640, 28, TEXT, 600)).join("") +
		lines(
			["Every key shows where a press will go. Nothing is typed into an agent", "waiting at a permission prompt; esc still gets through."],
			960,
			760,
			30,
			SUBTEXT,
			"middle",
		),
);

const pager = canvas(
	text("Scales past the deck", 960, 150, 76, TEXT, 700) +
		text("More workspaces than keys? The last two keys become a pager. New Space adds one.", 960, 216, 34, SUBTEXT, 400) +
		[tiles.working, tiles.blocked, pagerTile(true, 1, 3, false, false), pagerTile(false, 1, 3, true, false), newSpaceTile(false)]
			.map((tile, i) => embed(tile, 110 + i * 350, 360, 300))
			.join("") +
		text("Arrows show the page; the one pointing at the focused workspace lights green.", 960, 790, 30, SUBTEXT, 400),
);

mkdirSync("dist/media", { recursive: true });
writeFileSync("dist/media/thumbnail.svg", hero);
writeFileSync("dist/media/gallery-1-hero.svg", hero);
writeFileSync("dist/media/gallery-2-idle.svg", idle);
writeFileSync("dist/media/gallery-3-states.svg", states);
writeFileSync("dist/media/gallery-4-summary.svg", summary);
writeFileSync("dist/media/gallery-5-controls.svg", drive);
writeFileSync("dist/media/gallery-6-pager.svg", pager);
console.log("wrote dist/media/*.svg");
