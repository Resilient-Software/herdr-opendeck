import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import { type ControlBridge, controlFace, type ControlSettings, newTabDir, pressControl } from "../src/controls";
import type { Pane, Snapshot, Workspace } from "../src/herdr";
import { HerdrApiError } from "../src/socket";
import { resolveTarget, type Target } from "../src/state";

const dir = mkdtempSync(join(tmpdir(), "herdr-controls-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function space(id: string, number: number, label: string, overrides: Partial<Workspace> = {}): Workspace {
	return {
		workspace_id: id,
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

function pane(id: string, overrides: Partial<Pane> = {}): Pane {
	return {
		pane_id: id,
		workspace_id: id.split(":")[0],
		agent: "claude",
		agent_status: "idle",
		focused: false,
		cwd: `/home/dev/${id.split(":")[0]}`,
		...overrides,
	};
}

function snapshot(panes: Pane[]): Snapshot {
	return {
		focused_workspace_id: "w1",
		focused_pane_id: "w1:p1",
		workspaces: [space("w1", 1, "api-server", { focused: true }), space("w2", 2, "webapp")],
		panes,
	};
}

type Call = [string, ...unknown[]];

function fakeBridge(fail?: (method: string) => unknown): { bridge: ControlBridge; calls: Call[] } {
	const calls: Call[] = [];
	const record =
		(method: string) =>
			async (...args: unknown[]) => {
				calls.push([method, ...args]);
				const err = fail?.(method);
				if (err) {
					throw err;
				}
			};
	return {
		calls,
		bridge: {
			createTab: record("createTab"),
			promptAgent: record("promptAgent"),
			sendInput: record("sendInput"),
			sendKeys: record("sendKeys"),
			sendText: record("sendText"),
		},
	};
}

function okTarget(snap: Snapshot, setting: ControlSettings = {}): Extract<Target, { ok: true }> {
	const target = resolveTarget(snap, setting);
	if (!target.ok) {
		throw new Error(`no target: ${target.footer}`);
	}
	return target;
}

const raise = async () => {};

describe("pressControl", () => {
	test("Slash Command prompts the focused agent", async () => {
		const { bridge, calls } = fakeBridge();
		const flash = await pressControl("command", { command: " /review " }, okTarget(snapshot([pane("w1:p1")])), { bridge, raise });
		expect(calls).toEqual([["promptAgent", "w1:p1", "/review"]]);
		expect(flash).toEqual({ text: "SENT", ok: true });
	});

	test("nothing is typed into an agent waiting at a permission prompt", async () => {
		const { bridge, calls } = fakeBridge();
		const target = okTarget(snapshot([pane("w1:p1", { agent_status: "blocked" })]));
		for (const kind of ["command", "text", "cycle"] as const) {
			const flash = await pressControl(kind, { command: "/model", text: "go ahead", values: "opus" }, target, { bridge, raise }, "opus");
			expect(flash).toEqual({ text: "BLOCKED", ok: false });
		}
		expect(calls).toEqual([]);
	});

	test("Send Keys still reaches a blocked agent, esc by default", async () => {
		const { bridge, calls } = fakeBridge();
		const target = okTarget(snapshot([pane("w1:p1", { agent_status: "blocked" })]));
		await pressControl("keys", {}, target, { bridge, raise });
		await pressControl("keys", { keys: "Ctrl+C, shift+tab" }, target, { bridge, raise });
		expect(calls).toEqual([
			["sendKeys", "w1:p1", ["esc"]],
			["sendKeys", "w1:p1", ["ctrl+c", "shift+tab"]],
		]);
	});

	test("a bad key name sends nothing", async () => {
		const { bridge, calls } = fakeBridge();
		const flash = await pressControl("keys", { keys: "S-Tab" }, okTarget(snapshot([pane("w1:p1")])), { bridge, raise });
		expect(flash).toEqual({ text: "BAD KEY", ok: false });
		expect(calls).toEqual([]);
	});

	test("Send Text without Enter types only; a plain shell gets text plus Enter", async () => {
		const { bridge, calls } = fakeBridge();
		const shell = okTarget(snapshot([pane("w1:p1", { agent: undefined, agent_status: "unknown" })]));
		await pressControl("text", { text: "ls", submit: false }, shell, { bridge, raise });
		await pressControl("text", { text: "ls" }, shell, { bridge, raise });
		expect(calls).toEqual([
			["sendText", "w1:p1", "ls"],
			["sendInput", "w1:p1", "ls"],
		]);
	});

	test("Cycle sends the command with the value it was given", async () => {
		const { bridge, calls } = fakeBridge();
		await pressControl("cycle", { command: "/model" }, okTarget(snapshot([pane("w1:p1")])), { bridge, raise }, "sonnet");
		expect(calls).toEqual([["promptAgent", "w1:p1", "/model sonnet"]]);
	});

	test("an unset key sends nothing", async () => {
		const { bridge, calls } = fakeBridge();
		expect(await pressControl("command", {}, okTarget(snapshot([pane("w1:p1")])), { bridge, raise })).toEqual({ text: "NOT SET", ok: false });
		expect(calls).toEqual([]);
	});

	test("herdr refusals map to words the key can show", async () => {
		const target = okTarget(snapshot([pane("w1:p1")]));
		const cases: [string, string][] = [
			["agent_blocked", "BLOCKED"],
			["agent_not_ready", "NOT READY"],
			["agent_not_found", "NOT READY"],
			["pane_not_found", "GONE"],
			["something_else", "FAILED"],
		];
		for (const [code, text] of cases) {
			const { bridge } = fakeBridge(() => new HerdrApiError(code, code));
			expect(await pressControl("command", { command: "/review" }, target, { bridge, raise })).toEqual({ text, ok: false });
		}
		const { bridge } = fakeBridge(() => new Error("herdr socket timeout"));
		expect(await pressControl("command", { command: "/review" }, target, { bridge, raise })).toEqual({ text: "FAILED", ok: false });
	});

	test("New Tab opens in the target pane's folder and raises the terminal", async () => {
		const { bridge, calls } = fakeBridge();
		let raised = 0;
		const target = okTarget(snapshot([pane("w1:p1"), pane("w2:p1")]), { target: "w2", targetLabel: "webapp" });
		const flash = await pressControl("newtab", {}, target, { bridge, raise: async () => void raised++ });
		expect(calls).toEqual([["createTab", "w2", "/home/dev/w2"]]);
		expect(flash).toEqual({ text: "OPENED", ok: true });
		expect(raised).toBe(1);
	});

	test("New Tab checks a chosen folder exists", async () => {
		const { bridge, calls } = fakeBridge();
		const target = okTarget(snapshot([pane("w1:p1")]));
		expect(await pressControl("newtab", { cwd: join(dir, "missing") }, target, { bridge, raise })).toEqual({ text: "NO SUCH DIR", ok: false });
		await pressControl("newtab", { cwd: dir }, target, { bridge, raise });
		expect(calls).toEqual([["createTab", "w1", dir]]);
	});
});

describe("controlFace", () => {
	const snap = snapshot([pane("w1:p1"), pane("w2:p1")]);

	test("shows where a press goes", () => {
		expect(controlFace("command", { command: "/review" }, resolveTarget(snap, {}), 0)).toMatchObject({
			caption: "command",
			value: "/review",
			footer: "> api-server",
			dim: false,
		});
		expect(controlFace("keys", { target: "w2", targetLabel: "webapp" }, resolveTarget(snap, { target: "w2", targetLabel: "webapp" }), 0)).toMatchObject({
			value: "esc",
			footer: "#2 webapp",
		});
	});

	test("a pin whose workspace id was reused shows GONE, dimmed", () => {
		const setting = { target: "w2", targetLabel: "docs" };
		expect(controlFace("command", { ...setting, command: "/review" }, resolveTarget(snap, setting), 0)).toMatchObject({
			footer: "GONE",
			dim: true,
		});
	});

	test("bad keys and unset keys say so", () => {
		expect(controlFace("keys", { keys: "home" }, resolveTarget(snap, {}), 0)).toMatchObject({ dim: true, flash: { text: "BAD KEY", ok: false } });
		expect(controlFace("text", { text: "  " }, resolveTarget(snap, {}), 0)).toMatchObject({ footer: "NOT SET", dim: true });
		expect(controlFace("cycle", { command: "/model" }, resolveTarget(snap, {}), 0)).toMatchObject({ footer: "NOT SET", dim: true });
	});

	test("Cycle shows the value the next press sends", () => {
		const settings = { command: "/model", values: "opus, sonnet, haiku" };
		expect(controlFace("cycle", settings, resolveTarget(snap, {}), 4)).toMatchObject({ caption: "/model", value: "sonnet" });
	});

	test("unready keys dim with the reason", () => {
		expect(controlFace("command", { command: "/review" }, undefined, 0, "OFFLINE")).toMatchObject({ footer: "OFFLINE", dim: true });
	});

	test("New Tab shows the folder it opens in", () => {
		expect(controlFace("newtab", {}, resolveTarget(snap, {}), 0)).toMatchObject({ value: "+", footer: "w1", tone: "green" });
		expect(newTabDir({ cwd: "~/code" }, undefined)).toMatch(/\/code$/);
	});
});
