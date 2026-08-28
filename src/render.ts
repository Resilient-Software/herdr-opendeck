/**
 * SVG key images for Herdr space tiles. Palette is Catppuccin Mocha,
 * matching Herdr's default theme family.
 */
import type { GitInfo, Workspace } from "./herdr";

const COL_BG = "#1e1e2e";
const COL_SURFACE = "#313244";
const COL_TEXT = "#cdd6f4";
const COL_SUBTEXT = "#a6adc8";
const COL_RED = "#f38ba8";
const COL_YELLOW = "#f9e2af";
const COL_GREEN = "#a6e3a1";
const COL_OVERLAY = "#6c7086";

export type TileOpts = {
	dim?: boolean;
	footer?: string;
	footerRed?: boolean;
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
 * focused, yellow when an agent is working, red when an agent is blocked,
 * plain otherwise, with the lifecycle word in the footer when the
 * background is plain. Text mirrors how Herdr names the workspace, plus
 * where it is operating: repository and branch.
 */
export function spaceTile(space: Workspace, info: GitInfo, opt: TileOpts): string {
	let background = COL_BG;
	let foreground = COL_TEXT;
	let sub = COL_SUBTEXT;
	let plain = true;
	if (!opt.dim) {
		if (space.focused) {
			[background, foreground, sub, plain] = [COL_GREEN, COL_BG, COL_SURFACE, false];
		} else if (space.agent_status === "blocked") {
			[background, foreground, sub, plain] = [COL_RED, COL_BG, COL_SURFACE, false];
		} else if (space.agent_status === "working") {
			[background, foreground, sub, plain] = [COL_YELLOW, COL_BG, COL_SURFACE, false];
		}
	}
	const label = space.label || `Space ${space.number}`;
	let footer = opt.footer ?? "";
	if (!footer && plain && !opt.dim) {
		footer = (space.agent_status || "unknown").toUpperCase();
	}
	const footerColor = opt.footerRed ? COL_RED : sub;

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	svg += `<rect width="144" height="144" fill="${background}"/>`;
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
	if (footer) {
		svg += `<text x="72" y="132" fill="${footerColor}" font-family="sans-serif" font-size="13" text-anchor="middle">${esc(footer)}</text>`;
	}
	svg += `</svg>`;
	return dataUrl(svg);
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
	svg += `<rect width="144" height="144" fill="${COL_BG}"/>`;
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
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" fill="${COL_BG}"/><circle cx="72" cy="72" r="7" fill="${COL_SURFACE}"/></svg>`,
	);
}

export function newSpaceTile(dim: boolean): string {
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`;
	svg += `<rect width="144" height="144" fill="${COL_BG}"/>`;
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
	svg += `<rect width="144" height="144" fill="${COL_BG}"/>`;
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
