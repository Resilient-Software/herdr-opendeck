/**
 * Turns captured key images into PNGs a human (or a model) can look at:
 * one PNG per key, and a composite of the whole device face. Uses
 * rsvg-convert (librsvg), which is close to but not identical to the
 * Elgato app's Qt renderer — fonts and glyph fallback differ.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const KEY = 144;
const GAP = 22;
const PAD = 26;

export function svgToPng(svgFile, pngFile, size = KEY) {
	execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-o", pngFile, svgFile]);
	return pngFile;
}

function innerSvg(svgText) {
	return svgText.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

/**
 * cells: [{ column, row, svg?: string, label?: string }] — svg is the
 * key's SVG text (keys without one draw as "not ours": a dark key with a
 * dash). Writes board.svg and board.png and returns the PNG path.
 */
export function renderBoard({ columns, rows, cells, title, svgFile, pngFile }) {
	const width = PAD * 2 + columns * KEY + (columns - 1) * GAP;
	const height = PAD * 2 + rows * KEY + (rows - 1) * GAP + (title ? 30 : 0);
	const top = title ? 30 : 0;
	let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
	out += `<rect width="${width}" height="${height}" rx="28" fill="#0b0b0f"/>`;
	if (title) {
		out += `<text x="${PAD}" y="28" fill="#9399b2" font-family="sans-serif" font-size="16">${title.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text>`;
	}
	out += `<defs><clipPath id="key"><rect width="${KEY}" height="${KEY}" rx="16"/></clipPath></defs>`;
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const x = PAD + column * (KEY + GAP);
			const y = top + PAD + row * (KEY + GAP);
			const cell = cells.find((c) => c.column === column && c.row === row);
			out += `<g transform="translate(${x} ${y})" clip-path="url(#key)">`;
			out += `<rect width="${KEY}" height="${KEY}" fill="#000"/>`;
			if (cell?.svg) {
				out += `<svg x="0" y="0" width="${KEY}" height="${KEY}" viewBox="0 0 ${KEY} ${KEY}">${innerSvg(cell.svg)}</svg>`;
			} else {
				out += `<rect width="${KEY}" height="${KEY}" fill="#18181f"/><text x="72" y="80" fill="#45475a" font-family="sans-serif" font-size="22" text-anchor="middle">—</text>`;
			}
			out += `</g>`;
		}
	}
	out += `</svg>`;
	writeFileSync(svgFile, out);
	execFileSync("rsvg-convert", ["-o", pngFile, svgFile]);
	return pngFile;
}
