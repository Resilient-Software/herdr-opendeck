/**
 * Generates Marketplace listing media (icon, thumbnail, gallery) as SVGs
 * under dist/media/, composing the plugin's real tile renderers so the
 * shots match what ships. Render to PNG with scripts/gen-media.sh (needs rsvg-convert).
 */
import { mkdirSync, writeFileSync } from "node:fs";

import type { Workspace } from "../src/herdr";
import { newSpaceTile, pagerTile, spaceTile } from "../src/render";

const BG = "#11111b";
const TEXT = "#cdd6f4";
const SUBTEXT = "#a6adc8";
const BORDER = "#313244";

let clipSeq = 0;

function tileMarkup(dataUrl: string): string {
	const svg = Buffer.from(dataUrl.replace("data:image/svg+xml;base64,", ""), "base64").toString();
	return svg.replace(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`, "").replace(/<\/svg>$/, "");
}

function key(dataUrl: string, x: number, y: number, size: number): string {
	const id = `clip${clipSeq++}`;
	const scale = size / 144;
	return (
		`<g transform="translate(${x} ${y}) scale(${scale})">` +
		`<clipPath id="${id}"><rect width="144" height="144" rx="16"/></clipPath>` +
		`<g clip-path="url(#${id})">${tileMarkup(dataUrl)}</g>` +
		`<rect width="144" height="144" rx="16" fill="none" stroke="${BORDER}" stroke-width="3"/>` +
		`</g>`
	);
}

function text(value: string, x: number, y: number, size: number, color: string, weight = 600, anchor = "middle"): string {
	return `<text x="${x}" y="${y}" fill="${color}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${value}</text>`;
}

function canvas(body: string): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="960" viewBox="0 0 1920 960">` +
		`<rect width="1920" height="960" fill="${BG}"/>` +
		body +
		`</svg>`
	);
}

function space(number: number, label: string, status: Workspace["agent_status"], focused: boolean): Workspace {
	return {
		workspace_id: `w${number}`,
		number,
		label,
		agent_status: status,
		pane_count: 1,
		tab_count: 1,
		focused,
		worktree: null,
	};
}

mkdirSync("dist/media", { recursive: true });

const focused = spaceTile(space(1, "api-server", "idle", true), { repo: "backend", branch: "main" }, {});
const working = spaceTile(space(2, "refactor", "working", false), { repo: "webapp", branch: "feat/nav" }, {});
const blocked = spaceTile(space(3, "migration", "blocked", false), { repo: "infra", branch: "db-move" }, {});
const idle = spaceTile(space(4, "docs", "idle", false), { repo: "handbook", branch: "main" }, {});

const thumbnail = canvas(
	text("Herdr Deck", 520, 400, 120, TEXT, 700) +
		text("Your Herdr session on real keys:", 520, 490, 44, SUBTEXT, 400) +
		text("live tiles for every agent workspace", 520, 550, 44, SUBTEXT, 400) +
		key(focused, 1060, 200, 280) +
		key(working, 1380, 200, 280) +
		key(blocked, 1060, 520, 280) +
		key(idle, 1380, 520, 280),
);

const gallery1 = canvas(
	text("Agent status at a glance", 960, 150, 72, TEXT, 700) +
		text("Green focused · yellow working · red needs input · plain idle", 960, 220, 40, SUBTEXT, 400) +
		key(focused, 170, 360, 320) +
		key(working, 590, 360, 320) +
		key(blocked, 1010, 360, 320) +
		key(idle, 1430, 360, 320),
);

const gallery2 = canvas(
	text("Scales past the deck", 960, 150, 72, TEXT, 700) +
		text("More spaces than keys? The last two keys become a pager", 960, 220, 40, SUBTEXT, 400) +
		key(focused, 170, 360, 320) +
		key(working, 590, 360, 320) +
		key(pagerTile(true, 1, 2, false, false), 1010, 360, 320) +
		key(pagerTile(false, 1, 2, true, false), 1430, 360, 320),
);

const beforeFocus = spaceTile(space(5, "api-server", "idle", false), { repo: "backend", branch: "main" }, {});
const afterFocus = spaceTile(space(5, "api-server", "idle", true), { repo: "backend", branch: "main" }, {});

const gallery3 = canvas(
	text("Press to focus", 960, 150, 72, TEXT, 700) +
		text("The tile turns green when its workspace has focus", 960, 220, 40, SUBTEXT, 400) +
		key(beforeFocus, 550, 360, 320) +
		text("→", 950, 550, 72, SUBTEXT, 700) +
		key(afterFocus, 1050, 360, 320),
);

const gallery4 = canvas(
	text("Watch your agents work", 960, 150, 72, TEXT, 700) +
		text("Yellow while an agent is busy — glance at the herd without switching windows", 960, 220, 40, SUBTEXT, 400) +
		key(spaceTile(space(1, "refactor", "working", false), { repo: "webapp", branch: "feat/nav" }, {}), 170, 360, 320) +
		key(spaceTile(space(2, "tests", "working", false), { repo: "backend", branch: "main" }, {}), 590, 360, 320) +
		key(spaceTile(space(3, "docs-gen", "working", false), { repo: "handbook", branch: "main" }, {}), 1010, 360, 320) +
		key(newSpaceTile(false), 1430, 360, 320),
);

writeFileSync("dist/media/thumbnail.svg", thumbnail);
writeFileSync("dist/media/gallery-1-status.svg", gallery1);
writeFileSync("dist/media/gallery-2-pager.svg", gallery2);
writeFileSync("dist/media/gallery-3-focus.svg", gallery3);
writeFileSync("dist/media/gallery-4-working.svg", gallery4);
console.log("wrote dist/media/*.svg");
