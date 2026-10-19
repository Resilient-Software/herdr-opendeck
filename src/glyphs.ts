/**
 * Pictograms drawn as SVG paths rather than emoji or symbol characters: the
 * Elgato app (QtSvg), OpenDeck (a webview canvas) and rsvg-convert all draw
 * text glyphs differently, and colour emoji ignore fill, but paths render
 * the same everywhere and take the footer's tint. Each glyph is authored in
 * a 24-unit box.
 */
import type { FooterItem } from "./activity";

export type GlyphName = "clock" | "loop" | "monitor" | "shell" | "subagents";

const GLYPH: Record<GlyphName, string> = {
	// Robot head with knocked-out eyes and an antenna.
	subagents:
		'<circle cx="12" cy="2.7" r="2.5"/><rect x="10.5" y="3" width="3" height="4"/>' +
		'<path fill-rule="evenodd" d="M6.5 6.5h11a4.5 4.5 0 0 1 4.5 4.5v7a4.5 4.5 0 0 1-4.5 4.5h-11a4.5 4.5 0 0 1-4.5-4.5v-7a4.5 4.5 0 0 1 4.5-4.5zM5.4 14a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0zM13.4 14a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0z"/>',
	// Terminal window with a knocked-out prompt chevron and cursor.
	shell: '<path fill-rule="evenodd" d="M4 3h16a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-16a3 3 0 0 1-3-3v-12a3 3 0 0 1 3-3zM4.4 8.6l2.3-2.3l5.7 5.7l-5.7 5.7l-2.3-2.3l3.4-3.4zM13.2 14.8h6.2v3.2h-6.2z"/>',
	// Eye.
	monitor:
		'<path fill-rule="evenodd" d="M0.5 12C3.8 1.3 20.2 1.3 23.5 12C20.2 22.7 3.8 22.7 0.5 12zM4.2 12C7 5.6 17 5.6 19.8 12C17 18.4 7 18.4 4.2 12z"/><circle cx="12" cy="12" r="2.8"/>',
	// Clockwise circular arrow: a recurring loop.
	loop: '<path d="M14.8 5.4A7.6 7.6 0 1 1 5 9.6" fill="none" stroke="COLOUR" stroke-width="3.4" stroke-linecap="round"/><path d="M7 4.5L9 12.5L0.1 8.9z"/>',
	// Clock face: a one-off scheduled check.
	clock:
		'<path fill-rule="evenodd" d="M0.8 12a11.2 11.2 0 1 0 22.4 0a11.2 11.2 0 1 0-22.4 0zM4.1 12a7.9 7.9 0 1 0 15.8 0a7.9 7.9 0 1 0-15.8 0z"/><path d="M12 7.6V12.4H15.8" fill="none" stroke="COLOUR" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function glyph(name: GlyphName, x: number, y: number, size: number, colour: string): string {
	return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24, 4)})" fill="${colour}">${GLYPH[name].replaceAll("COLOUR", colour)}</g>`;
}

const ICON = 20;
const FONT = 18;
const GAP = 2;
const SEP = 9;
const MAX_WIDTH = 132;
const MAX_ITEMS = 3;

/**
 * Bold advances in em, rounded up from the widest of the fonts each host
 * resolves "sans-serif" to; SVG text cannot be measured here.
 */
const ADVANCE: Record<string, number> = { D: 0.72, H: 0.73, M: 0.86, N: 0.72, O: 0.78, S: 0.67, W: 0.97 };

function advance(c: string): number {
	return ADVANCE[c] ?? (c >= "0" && c <= "9" ? 0.66 : 0.75);
}

function itemWidth(item: FooterItem): number {
	return ICON + GAP + [...item.text].reduce((width, c) => width + advance(c) * FONT, 0);
}

function rowWidth(items: FooterItem[]): number {
	return items.reduce((width, item) => width + itemWidth(item), 0) + SEP * (items.length - 1);
}

/**
 * A centred row of pictogram + count items on the band centred at cy,
 * dropping trailing items until the row fits a key.
 */
export function footerRow(items: FooterItem[], cy: number, colour: string): string {
	let row = items.slice(0, MAX_ITEMS);
	while (row.length > 1 && rowWidth(row) > MAX_WIDTH) {
		row = row.slice(0, -1);
	}
	let x = 72 - rowWidth(row) / 2;
	const baseline = cy + FONT * 0.36;
	let svg = "";
	for (const item of row) {
		svg += glyph(item.glyph, x, cy - ICON / 2, ICON, colour);
		svg += `<text x="${round(x + ICON + GAP)}" y="${round(baseline)}" fill="${colour}" font-family="sans-serif" font-size="${FONT}" font-weight="700">${item.text}</text>`;
		x += itemWidth(item) + SEP;
	}
	return svg;
}

function round(n: number, places = 2): number {
	return Number(n.toFixed(places));
}
