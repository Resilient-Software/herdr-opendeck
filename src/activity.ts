/**
 * Optional agent activity published by the herdr-agent-activity plugin as
 * workspace/pane metadata tokens (contract v1). Everything here fails open:
 * without the plugin, or with a contract version we do not understand, there
 * is simply no activity and tiles render exactly as before.
 */
import type { GlyphName } from "./glyphs";

export type ActivityState = "background" | "scheduled" | "subagents";

export type Activity = {
	state: ActivityState;
	subagents: number;
	background: number;
	monitors: number;
	/** Epoch ms of the next scheduled wake-up, if any. */
	nextAt: number | null;
	loop: boolean;
};

export type Tokens = Record<string, string | null | undefined>;

const CONTRACT_VERSION = "1";

function count(value: string | null | undefined): number {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : 0;
}

export function parseActivity(tokens: Tokens | null | undefined): Activity | null {
	if (!tokens || tokens.rsact_v !== CONTRACT_VERSION || !tokens.rsact_state) {
		return null;
	}
	const known: ActivityState[] = ["subagents", "background", "scheduled"];
	// Unknown future states are additive; treat them as background work.
	const state = known.includes(tokens.rsact_state as ActivityState) ? (tokens.rsact_state as ActivityState) : "background";
	const nextAt = tokens.rsact_next_at ? Date.parse(tokens.rsact_next_at) : NaN;
	return {
		state,
		subagents: count(tokens.rsact_subagents),
		background: count(tokens.rsact_background),
		monitors: count(tokens.rsact_monitors),
		nextAt: Number.isFinite(nextAt) ? nextAt : null,
		loop: tokens.rsact_loop === "1",
	};
}

/** "NOW", "IN 45S", "IN 4M", "IN 2H", "IN 3D". */
export function countdown(nextAt: number, now: number): string {
	const seconds = Math.round((nextAt - now) / 1000);
	if (seconds <= 0) {
		return "NOW";
	}
	if (seconds < 60) {
		return `IN ${seconds}S`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `IN ${minutes}M`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `IN ${hours}H` : `IN ${Math.round(hours / 24)}D`;
}

export type FooterItem = { glyph: GlyphName; text: string };

/**
 * Footer pictograms with counts, dominant activity first: subagents,
 * background shells, monitors; a countdown ("4M", "NOW") only when nothing
 * runs.
 */
export function activityItems(activity: Activity, now: number): FooterItem[] {
	const items: FooterItem[] = [];
	if (activity.subagents) {
		items.push({ glyph: "subagents", text: String(activity.subagents) });
	}
	if (activity.background) {
		items.push({ glyph: "shell", text: String(activity.background) });
	}
	if (activity.monitors) {
		items.push({ glyph: "monitor", text: String(activity.monitors) });
	}
	if (items.length === 0 && activity.nextAt !== null) {
		items.push({ glyph: activity.loop ? "loop" : "clock", text: countdown(activity.nextAt, now).replace(/^IN /, "") });
	}
	return items;
}
