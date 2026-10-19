/**
 * The control keys: what each one shows and what a press sends. The
 * controller owns timing, the Cycle index and settings persistence; this
 * module decides faces and talks to herdr through the injected bridge.
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";

import type { Bridge } from "./herdr";
import { cycleText, cycleValues, DEFAULT_KEYS, parseKeys } from "./keys";
import type { ControlFace } from "./render";
import { HerdrApiError } from "./socket";
import type { Target, TargetSetting } from "./state";

export type ControlKind = "command" | "cycle" | "keys" | "newtab" | "text";

export type ControlSettings = TargetSetting & {
	command?: string;
	cwd?: string;
	index?: number;
	keys?: string;
	submit?: boolean;
	text?: string;
	values?: string;
};

export type ControlBridge = Pick<Bridge, "createTab" | "promptAgent" | "sendInput" | "sendKeys" | "sendText">;

export type Flash = { text: string; ok: boolean };

export type PressDeps = {
	bridge: ControlBridge;
	raise: () => Promise<void>;
};

function keysSetting(settings: ControlSettings): string {
	return settings.keys?.trim() || DEFAULT_KEYS;
}

function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

function isDirectory(path: string): boolean {
	return existsSync(path) && statSync(path).isDirectory();
}

/** The folder New Tab opens in: the chosen one, else the target pane's. */
export function newTabDir(settings: ControlSettings, target: Target | undefined): string {
	const chosen = settings.cwd?.trim();
	if (chosen) {
		return expandHome(chosen);
	}
	return target?.ok ? (target.pane.cwd ?? "") : "";
}

/** What a press of a text-sending key types, or "" when unset. */
export function sendText(kind: ControlKind, settings: ControlSettings, cycleValue = ""): string {
	switch (kind) {
		case "command":
			return settings.command?.trim() ?? "";
		case "text":
			return settings.text ?? "";
		case "cycle":
			return cycleValue ? cycleText(settings.command ?? "", cycleValue) : "";
		default:
			return "";
	}
}

/**
 * The key face. Without a target (connecting, offline, GONE, NO AGENT) the
 * face dims and the footer says why; a press then does nothing.
 */
export function controlFace(
	kind: ControlKind,
	settings: ControlSettings,
	target: Target | undefined,
	cycleIndex: number,
	unready = "",
): ControlFace {
	const dim = !target?.ok;
	const footer = target ? target.footer : unready;
	switch (kind) {
		case "command": {
			const command = settings.command?.trim();
			return command
				? { caption: "command", value: command, footer, tone: "blue", dim }
				: { caption: "command", value: "—", footer: "NOT SET", tone: "blue", dim: true };
		}
		case "text": {
			const first = (settings.text ?? "").split(/\r?\n/)[0].trim();
			return first
				? { caption: "text", value: first, footer, tone: "blue", dim }
				: { caption: "text", value: "—", footer: "NOT SET", tone: "blue", dim: true };
		}
		case "keys": {
			const parsed = parseKeys(keysSetting(settings));
			if ("error" in parsed) {
				return { caption: "keys", value: keysSetting(settings), footer, tone: "blue", dim: true, flash: { text: "BAD KEY", ok: false } };
			}
			return { caption: "keys", value: parsed.keys.join(" "), footer, tone: "blue", dim };
		}
		case "cycle": {
			const values = cycleValues(settings.values ?? "");
			const caption = settings.command?.trim() || "cycle";
			if (values.length === 0) {
				return { caption, value: "—", footer: "NOT SET", tone: "blue", dim: true };
			}
			return { caption, value: values[cycleIndex % values.length], footer, tone: "blue", dim };
		}
		case "newtab": {
			const dir = newTabDir(settings, target);
			return { caption: "new tab", value: "+", footer: target?.ok && dir ? basename(dir) || dir : footer, tone: "green", dim };
		}
	}
}

/** Maps herdr's refusals to the words a key can show. */
function failure(err: unknown): Flash {
	switch (err instanceof HerdrApiError ? err.code : "") {
		case "agent_blocked":
			return { text: "BLOCKED", ok: false };
		case "agent_not_ready":
		case "agent_not_found":
			return { text: "NOT READY", ok: false };
		case "invalid_key":
			return { text: "BAD KEY", ok: false };
		case "pane_not_found":
		case "workspace_not_found":
			return { text: "GONE", ok: false };
		default:
			return { text: "FAILED", ok: false };
	}
}

/**
 * Sends one press. An agent waiting at a permission prompt gets no typed
 * text (herdr 0.8.2+ also refuses it server-side), but Send Keys still goes
 * through so esc can dismiss the prompt.
 */
export async function pressControl(
	kind: ControlKind,
	settings: ControlSettings,
	target: Extract<Target, { ok: true }>,
	deps: PressDeps,
	cycleValue = "",
): Promise<Flash> {
	const { pane } = target;
	try {
		if (kind === "keys") {
			const parsed = parseKeys(keysSetting(settings));
			if ("error" in parsed) {
				return { text: "BAD KEY", ok: false };
			}
			await deps.bridge.sendKeys(pane.pane_id, parsed.keys);
			return { text: "SENT", ok: true };
		}
		if (kind === "newtab") {
			const dir = newTabDir(settings, target);
			if (settings.cwd?.trim() && !isDirectory(dir)) {
				return { text: "NO SUCH DIR", ok: false };
			}
			await deps.bridge.createTab(target.workspace.workspace_id, dir || undefined);
			await deps.raise();
			return { text: "OPENED", ok: true };
		}
		const text = sendText(kind, settings, cycleValue);
		if (!text.trim()) {
			return { text: "NOT SET", ok: false };
		}
		if (pane.agent && pane.agent_status === "blocked") {
			return { text: "BLOCKED", ok: false };
		}
		const submit = kind !== "text" || settings.submit !== false;
		if (!submit) {
			await deps.bridge.sendText(pane.pane_id, text);
		} else if (pane.agent) {
			await deps.bridge.promptAgent(pane.pane_id, text);
		} else {
			await deps.bridge.sendInput(pane.pane_id, text);
		}
		return { text: "SENT", ok: true };
	} catch (err) {
		return failure(err);
	}
}
