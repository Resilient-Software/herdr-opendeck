/**
 * SVG key images. Palette is Catppuccin Mocha, matching Herdr's default
 * theme family.
 */
import { activityItems, countdown, type FooterItem, parseActivity } from "./activity";
import { footerRow } from "./glyphs";
import type { GitInfo, Workspace } from "./herdr";
import { type Counts, spaceName, type SpaceState } from "./state";

const COL_BG = "#1e1e2e";
const COL_SURFACE = "#313244";
const COL_TEXT = "#cdd6f4";
const COL_SUBTEXT = "#a6adc8";
const COL_RED = "#f38ba8";
const COL_YELLOW = "#f9e2af";
const COL_GREEN = "#a6e3a1";
const COL_BLUE = "#89b4fa";
const COL_MAUVE = "#cba6f7";
/** Near-black mauve: waiting on a timer, calmer than the "busy" fields. */
const COL_MAUVE_DARK = "#362a52";
const COL_OVERLAY = "#6c7086";
const COL_TEAL = "#94e2d5";

export type TileOpts = {
	dim?: boolean;
	footer?: string;
	footerRed?: boolean;
	/** Clock for activity countdowns; defaults to Date.now(). */
	now?: number;
};

/**
 * Base64 is the one data-URL form both Elgato's setImage contract and stock
 * OpenDeck render reliably.
 */
function dataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function esc(s: string): string {
	return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncate(s: string, maxChars: number): string {
	const chars = [...s];
	if (chars.length <= maxChars) {
		return s;
	}
	return chars.slice(0, maxChars - 1).join("") + "…";
}

/**
 * The whole key background carries the state: green when the workspace is
 * focused, red when an agent is blocked, yellow when an agent is working,
 * blue when agents are idle but subagents or background tasks are still
 * running, near-black mauve with a mauve countdown when their only
 * activity is a scheduled check (both from
 * the optional herdr-agent-activity tokens), plain otherwise.
 * The footer names the state whenever colour alone would carry it: the
 * lifecycle word on plain tiles, activity pictograms with counts (or the
 * countdown) whenever there is some. Text mirrors how Herdr names the workspace, plus
 * where it is operating: repository and branch.
 */
export function spaceTile(space: Workspace, info: GitInfo, opt: TileOpts): string {
	let background = COL_BG;
	let foreground = COL_TEXT;
	let sub = COL_SUBTEXT;
	let plain = true;
	const activity = parseActivity(space.tokens);
	if (!opt.dim) {
		if (space.focused) {
			[background, foreground, sub, plain] = [COL_GREEN, COL_BG, COL_SURFACE, false];
		} else if (space.agent_status === "blocked") {
			[background, foreground, sub, plain] = [COL_RED, COL_BG, COL_SURFACE, false];
		} else if (space.agent_status === "working") {
			[background, foreground, sub, plain] = [COL_YELLOW, COL_BG, COL_SURFACE, false];
		} else if (activity?.state === "scheduled") {
			[background, plain] = [COL_MAUVE_DARK, false];
		} else if (activity) {
			[background, foreground, sub, plain] = [COL_BLUE, COL_BG, COL_SURFACE, false];
		}
	}
	const label = spaceName(space);
	let footer = opt.footer ?? "";
	let items: FooterItem[] = [];
	if (!footer && !opt.dim && activity) {
		items = activityItems(activity, opt.now ?? Date.now());
	}
	if (!footer && !items.length && plain && !opt.dim) {
		footer = (space.agent_status || "unknown").toUpperCase();
	}
	const footerColor = opt.footerRed ? COL_RED : sub;

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	if (background !== COL_BG) {
		svg += `<rect width="144" height="144" fill="${background}"/>`;
	}
	if (opt.dim) {
		svg += `<g opacity="0.45">`;
	}
	svg += `<text x="10" y="26" fill="${sub}" font-family="sans-serif" font-size="16" font-weight="700">${space.number}</text>`;
	svg += `<text x="72" y="58" fill="${foreground}" font-family="sans-serif" font-size="20" font-weight="600" text-anchor="middle">${esc(truncate(label, 13))}</text>`;
	if (info.repo) {
		svg += `<text x="72" y="84" fill="${sub}" font-family="sans-serif" font-size="15" text-anchor="middle">${esc(truncate(info.repo, 16))}</text>`;
	}
	if (info.branch) {
		svg += `<text x="72" y="106" fill="${sub}" font-family="sans-serif" font-size="15" text-anchor="middle">⎇ ${esc(truncate(info.branch, 15))}</text>`;
	}
	if (opt.dim) {
		svg += `</g>`;
	}
	if (items.length) {
		svg += footerRow(items, 124, background === COL_MAUVE_DARK ? COL_MAUVE : COL_BG);
	} else if (footer) {
		svg += `<text x="72" y="132" fill="${footerColor}" font-family="sans-serif" font-size="13" text-anchor="middle">${esc(footer)}</text>`;
	}
	svg += `</svg>`;
	return dataUrl(svg);
}

/** Summary order and colours: what needs you first. */
const STATES: { state: Exclude<SpaceState, "none">; colour: string; word: string }[] = [
	{ state: "blocked", colour: COL_RED, word: "BLOCKED" },
	{ state: "working", colour: COL_YELLOW, word: "WORKING" },
	{ state: "background", colour: COL_BLUE, word: "BUSY" },
	{ state: "scheduled", colour: COL_MAUVE, word: "TIMER" },
	{ state: "done", colour: COL_TEAL, word: "DONE" },
	{ state: "idle", colour: COL_OVERLAY, word: "IDLE" },
];

export type SummaryLook = "list" | "ring";

export type SummaryOpts = {
	dim?: boolean;
	footer?: string;
	footerRed?: boolean;
	now?: number;
};

function polar(cx: number, cy: number, r: number, degrees: number): string {
	const radians = ((degrees - 90) * Math.PI) / 180;
	return `${round(cx + r * Math.cos(radians))} ${round(cy + r * Math.sin(radians))}`;
}

/** Arcs drawn as paths: dash patterns differ between the hosts' renderers. */
function ring(counts: Counts | null, cx: number, cy: number, r: number, width: number): string {
	const present = counts ? STATES.filter((s) => counts[s.state] > 0) : [];
	if (!counts || counts.total === 0) {
		return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COL_SURFACE}" stroke-width="${width}"/>`;
	}
	if (present.length === 1) {
		return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${present[0].colour}" stroke-width="${width}"/>`;
	}
	const gap = 4;
	let start = 0;
	let svg = "";
	for (const s of present) {
		const sweep = (360 * counts[s.state]) / counts.total;
		const from = start + gap / 2;
		const to = start + sweep - gap / 2;
		const large = to - from > 180 ? 1 : 0;
		svg += `<path d="M${polar(cx, cy, r, from)}A${r} ${r} 0 ${large} 1 ${polar(cx, cy, r, to)}" fill="none" stroke="${s.colour}" stroke-width="${width}"/>`;
		start += sweep;
	}
	return svg;
}

/**
 * The summary footer says what to do next: blocked agents first, then
 * finished ones, then the soonest scheduled check.
 */
function summaryFooter(counts: Counts, opt: SummaryOpts): string {
	if (opt.footer) {
		return text(72, 132, opt.footer, 13, opt.footerRed ? COL_RED : COL_SUBTEXT, 400);
	}
	if (counts.blocked) {
		return text(72, 132, `${counts.blocked} BLOCKED`, 13, COL_RED, 700);
	}
	if (counts.done) {
		return text(72, 132, `${counts.done} DONE`, 13, COL_TEAL, 700);
	}
	if (counts.nextAt !== null) {
		const when = countdown(counts.nextAt, opt.now ?? Date.now()).replace(/^IN /, "");
		return footerRow([{ glyph: counts.loop ? "loop" : "clock", text: when }], 124, COL_MAUVE);
	}
	return text(72, 132, counts.total ? "ALL BUSY" : "NO AGENTS", 13, COL_SUBTEXT, 400);
}

function summaryList(counts: Counts): string {
	const rows = STATES.filter((s) => counts[s.state] > 0);
	if (rows.length === 0) {
		return text(72, 78, "NO AGENTS", 15, COL_OVERLAY, 600);
	}
	const pitch = 21.5;
	let cy = 72 - ((rows.length - 1) * pitch) / 2;
	let svg = "";
	for (const row of rows) {
		svg += `<rect x="14" y="${round(cy - 6)}" width="12" height="12" rx="2" fill="${row.colour}"/>`;
		svg += `<text x="58" y="${round(cy + 6)}" fill="${COL_TEXT}" font-family="sans-serif" font-size="17" font-weight="700" text-anchor="end">${counts[row.state]}</text>`;
		svg += `<text x="66" y="${round(cy + 5)}" fill="${COL_SUBTEXT}" font-family="sans-serif" font-size="13">${row.word}</text>`;
		cy += pitch;
	}
	return svg;
}

/**
 * One key counting every workspace that runs an agent, by state. Without
 * counts (connecting, offline) it draws an empty ring and the footer only,
 * never stale numbers.
 */
export function summaryTile(counts: Counts | null, look: SummaryLook, opt: SummaryOpts = {}): string {
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	if (opt.dim) {
		svg += `<g opacity="0.45">`;
	}
	if (look === "list" && counts) {
		svg += summaryList(counts);
		if (opt.footer) {
			svg += text(72, 140, opt.footer, 11, opt.footerRed ? COL_RED : COL_SUBTEXT, 400);
		}
	} else {
		svg += ring(counts, 72, 62, 40, 16);
		svg += text(72, 74, counts ? String(counts.total) : "–", 34, COL_TEXT, 700);
		svg += counts ? summaryFooter(counts, opt) : text(72, 132, opt.footer ?? "", 13, opt.footerRed ? COL_RED : COL_SUBTEXT, 400);
	}
	if (opt.dim) {
		svg += `</g>`;
	}
	svg += `</svg>`;
	return dataUrl(svg);
}

export type ControlFace = {
	caption: string;
	value: string;
	footer: string;
	tone: "blue" | "green";
	dim?: boolean;
	flash?: { text: string; ok: boolean };
};

/** Splits a long value onto two lines at a space, when one exists. */
function valueLines(value: string): string[] {
	const chars = [...value];
	if (chars.length <= 11) {
		return [value];
	}
	const cut = value.lastIndexOf(" ", 12);
	if (cut > 0) {
		return [truncate(value.slice(0, cut), 12), truncate(value.slice(cut + 1).trim(), 12)];
	}
	return [truncate(value, 13)];
}

/**
 * A control key: what it does in small caps at the top, the command or
 * value large in the middle, and where a press goes at the bottom. A flash
 * replaces the footer briefly after a press.
 */
export function controlTile(face: ControlFace): string {
	const colour = face.tone === "green" ? COL_GREEN : COL_BLUE;
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	if (face.dim) {
		svg += `<g opacity="0.45">`;
	}
	svg += `<text x="10" y="24" fill="${COL_SUBTEXT}" font-family="sans-serif" font-size="13" font-weight="700">${esc(truncate(face.caption.toUpperCase(), 16))}</text>`;
	const lines = valueLines(face.value);
	if (lines.length === 2) {
		svg += text(72, 70, lines[0], 20, colour, 700);
		svg += text(72, 95, lines[1], 20, colour, 700);
	} else {
		const length = [...lines[0]].length;
		const size = length <= 1 ? 64 : length <= 5 ? 34 : length <= 8 ? 26 : 20;
		svg += text(72, 74 + size / 3, lines[0], size, colour, 700);
	}
	if (face.dim) {
		svg += `</g>`;
	}
	if (face.flash) {
		svg += text(72, 128, truncate(face.flash.text, 18), 13, face.flash.ok ? COL_GREEN : COL_RED, 700);
	} else if (face.footer) {
		svg += text(72, 128, truncate(face.footer, 18), 13, COL_SUBTEXT, 400);
	}
	svg += `</svg>`;
	return dataUrl(svg);
}

function text(x: number, y: number, value: string, size: number, colour: string, weight: number): string {
	return `<text x="${x}" y="${round(y)}" fill="${colour}" font-family="sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="middle">${esc(value)}</text>`;
}

function round(n: number): number {
	return Number(n.toFixed(2));
}

/**
 * One of the two pager controls: a large arrow with the page indicator
 * below. accent highlights the arrow when the focused space lies in its
 * direction; dim marks it inert while offline.
 */
export function pagerTile(left: boolean, current: number, total: number, accent: boolean, dim: boolean): string {
	const arrow = left ? "←" : "→";
	const arrowColor = accent ? COL_GREEN : COL_TEXT;
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	if (dim) {
		svg += `<g opacity="0.45">`;
	}
	svg += `<text x="72" y="82" fill="${arrowColor}" font-family="sans-serif" font-size="58" font-weight="700" text-anchor="middle">${arrow}</text>`;
	svg += `<text x="72" y="124" fill="${COL_SUBTEXT}" font-family="sans-serif" font-size="18" text-anchor="middle">${current}/${total}</text>`;
	if (dim) {
		svg += `</g>`;
	}
	svg += `</svg>`;
	return dataUrl(svg);
}

export function emptyTile(): string {
	return dataUrl(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><circle cx="72" cy="72" r="7" fill="${COL_SURFACE}"/></svg>`,
	);
}

export function newSpaceTile(dim: boolean): string {
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	if (dim) {
		svg += `<g opacity="0.45">`;
	}
	svg += `<text x="72" y="86" fill="${COL_GREEN}" font-family="sans-serif" font-size="64" font-weight="600" text-anchor="middle">+</text>`;
	svg += `<text x="72" y="124" fill="${COL_SUBTEXT}" font-family="sans-serif" font-size="15" text-anchor="middle">NEW SPACE</text>`;
	if (dim) {
		svg += `</g>`;
	}
	svg += `</svg>`;
	return dataUrl(svg);
}

function messageTile(lines: string[], color: string): string {
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	let y = 78 - 14 * (lines.length - 1);
	for (const line of lines) {
		svg += `<text x="72" y="${y}" fill="${color}" font-family="sans-serif" font-size="17" font-weight="600" text-anchor="middle">${esc(line)}</text>`;
		y += 28;
	}
	svg += `</svg>`;
	return dataUrl(svg);
}

export function connectingTile(): string {
	return messageTile(["HERDR", "CONNECTING"], COL_OVERLAY);
}

export function noSpacesTile(): string {
	return messageTile(["NO SPACES", "OPEN HERDR"], COL_OVERLAY);
}

export function offlineTile(): string {
	return messageTile(["HERDR", "OFFLINE"], COL_RED);
}
