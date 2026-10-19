import type { JsonObject } from "@elgato/utils";
import { describe, expect, test } from "vitest";

import { type BridgeLike, DeckController, type KeyHandle, type KeyKind } from "../src/controller";
import type { Pane, Snapshot, Workspace } from "../src/herdr";

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
		cwd: "/nonexistent/deck-test",
		...overrides,
	};
}

/** w1 focused and working, w2 blocked, w3 done, w4 idle. */
function session(): Snapshot {
	return {
		focused_workspace_id: "w1",
		focused_pane_id: "w1:p1",
		workspaces: [
			space("w1", 1, "api-server", { focused: true, agent_status: "working" }),
			space("w2", 2, "webapp", { agent_status: "blocked" }),
			space("w3", 3, "docs", { agent_status: "done" }),
			space("w4", 4, "infra"),
		],
		panes: [
			pane("w1:p1", { focused: true, agent_status: "working" }),
			pane("w2:p1", { agent_status: "blocked" }),
			pane("w3:p1", { agent_status: "done" }),
			pane("w4:p1"),
		],
	};
}

type Call = [string, ...unknown[]];

function fakeBridge(initial: Snapshot) {
	const calls: Call[] = [];
	const state = { snapshot: initial as Error | Snapshot };
	const record =
		(method: string) =>
			async (...args: unknown[]) => {
				calls.push([method, ...args]);
			};
	const bridge: BridgeLike = {
		createTab: record("createTab"),
		createWorkspace: record("createWorkspace"),
		focusWorkspace: record("focusWorkspace"),
		promptAgent: record("promptAgent"),
		sendInput: record("sendInput"),
		sendKeys: record("sendKeys"),
		sendText: record("sendText"),
		snapshot: async () => {
			if (state.snapshot instanceof Error) {
				throw state.snapshot;
			}
			return state.snapshot;
		},
		subscribeChanges: async () => {},
	};
	return { bridge, calls, state };
}

function svg(image: string | undefined): string {
	return Buffer.from((image ?? "").replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
}

class FakeKey implements KeyHandle {
	public alerts = 0;
	public images: string[] = [];
	public saved: JsonObject[] = [];

	constructor(public readonly coordinates: { column: number; row: number }) {}

	public get image(): string {
		return svg(this.images.at(-1));
	}

	public async setImage(image?: string): Promise<void> {
		this.images.push(image ?? "");
	}

	public async setSettings(settings: JsonObject): Promise<void> {
		this.saved.push(settings);
	}

	public async showAlert(): Promise<void> {
		this.alerts++;
	}
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

async function deck(snapshot = session()) {
	const fake = fakeBridge(snapshot);
	const controller = new DeckController({ bridge: fake.bridge, log: { error: () => {}, info: () => {} }, raise: async () => {}, tick: false });
	const keys = new Map<string, FakeKey>();
	const place = (id: string, kind: KeyKind, column: number, row: number, settings: JsonObject = {}) => {
		const key = new FakeKey({ column, row });
		keys.set(id, key);
		controller.add(id, key, kind, settings);
		return key;
	};
	const press = (id: string) => {
		controller.keyDown(id);
		controller.keyUp(id);
	};
	await controller.refresh();
	return { ...fake, controller, keys, place, press };
}

describe("Agent Summary", () => {
	test("counts agents by state and jumps to the blocked one first", async () => {
		const d = await deck();
		const summary = d.place("s", "summary", 0, 0);
		expect(summary.image).toContain(">4</text>");
		expect(summary.image).toContain("1 BLOCKED");
		d.press("s");
		await settle();
		expect(d.calls).toEqual([["focusWorkspace", "w2"]]);
		expect(summary.image).toContain("FOCUSING…");
	});

	test("says ALL CLEAR when nothing needs attention", async () => {
		const d = await deck({
			focused_workspace_id: "w1",
			workspaces: [space("w1", 1, "api-server", { focused: true, agent_status: "working" })],
			panes: [pane("w1:p1", { focused: true, agent_status: "working" })],
		});
		const summary = d.place("s", "summary", 0, 0, { look: "list" });
		d.press("s");
		expect(d.calls).toEqual([]);
		expect(summary.image).toContain("ALL CLEAR");
	});

});

describe("control keys", () => {
	test("Slash Command sends to the focused agent and flashes SENT", async () => {
		const d = await deck();
		const key = d.place("c", "command", 0, 0, { command: "/review" });
		expect(key.image).toContain("&gt; api-server");
		d.press("c");
		await settle();
		expect(d.calls).toEqual([["promptAgent", "w1:p1", "/review"]]);
		expect(key.image).toContain("SENT");
	});

	test("a key-up without its key-down does nothing", async () => {
		const d = await deck();
		d.place("c", "command", 0, 0, { command: "/review" });
		d.controller.keyUp("c");
		await settle();
		expect(d.calls).toEqual([]);
	});

	test("nothing is typed into a blocked agent, but Send Keys still reaches it", async () => {
		const d = await deck();
		const text = d.place("t", "text", 0, 0, { text: "go ahead", target: "w2", targetLabel: "webapp" });
		d.place("k", "keys", 1, 0, { target: "w2", targetLabel: "webapp" });
		d.press("t");
		d.press("k");
		await settle();
		expect(d.calls).toEqual([["sendKeys", "w2:p1", ["esc"]]]);
		expect(text.image).toContain("BLOCKED");
	});

	test("Cycle sends consecutive values on a fast double press and saves the index", async () => {
		const d = await deck();
		const key = d.place("y", "cycle", 0, 0, { command: "/model", values: "opus, sonnet, haiku" });
		expect(key.image).toContain(">opus<");
		d.press("y");
		d.press("y");
		await settle();
		expect(d.calls).toEqual([
			["promptAgent", "w1:p1", "/model opus"],
			["promptAgent", "w1:p1", "/model sonnet"],
		]);
		expect(key.saved.map((s) => s.index)).toEqual([1, 2]);
		expect(key.image).toContain(">haiku<");
	});

	test("presses send one at a time, so prompts never interleave", async () => {
		const d = await deck();
		const events: string[] = [];
		d.bridge.promptAgent = async (_pane: string, text: string) => {
			events.push(`start ${text}`);
			await new Promise((resolve) => setTimeout(resolve, 20));
			events.push(`end ${text}`);
		};
		d.place("y", "cycle", 0, 0, { command: "/model", values: "opus, sonnet" });
		d.press("y");
		d.press("y");
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(events).toEqual(["start /model opus", "end /model opus", "start /model sonnet", "end /model sonnet"]);
	});

	test("Cycle resumes from a saved index", async () => {
		const d = await deck();
		d.place("y", "cycle", 0, 0, { command: "/model", values: "opus, sonnet, haiku", index: 2 });
		d.press("y");
		await settle();
		expect(d.calls).toEqual([["promptAgent", "w1:p1", "/model haiku"]]);
	});

	test("a key pinned to a workspace id herdr reused is GONE and sends nothing", async () => {
		const d = await deck();
		const key = d.place("c", "command", 0, 0, { command: "/review", target: "w3", targetLabel: "billing" });
		expect(key.image).toContain("GONE");
		d.press("c");
		await settle();
		expect(d.calls).toEqual([]);
	});

	test("a pin follows its workspace by name after herdr reassigns the id", async () => {
		const d = await deck();
		const key = d.place("c", "command", 0, 0, { command: "/review", target: "w9", targetLabel: "docs" });
		expect(key.saved.at(-1)).toMatchObject({ target: "w3", targetLabel: "docs" });
		d.press("c");
		await settle();
		expect(d.calls).toEqual([["promptAgent", "w3:p1", "/review"]]);
	});

	test("a watched pin keeps up with a renamed workspace", async () => {
		const d = await deck();
		const key = d.place("c", "command", 0, 0, { command: "/review", target: "w3", targetLabel: "docs" });
		const renamed = session();
		renamed.workspaces[2].label = "handbook";
		d.state.snapshot = renamed;
		await d.controller.refresh();
		expect(key.image).toContain("#3 handbook");
		expect(key.saved.at(-1)).toMatchObject({ target: "w3", targetLabel: "handbook" });
	});
});

describe("offline", () => {
	test("summary and control keys dim, ignore presses and recover", async () => {
		const d = await deck();
		const summary = d.place("s", "summary", 0, 0);
		const command = d.place("c", "command", 1, 0, { command: "/review" });
		d.state.snapshot = new Error("herdr socket closed");
		for (let i = 0; i < 3; i++) {
			await d.controller.refresh();
		}
		expect(summary.image).toContain("OFFLINE");
		expect(summary.image).not.toMatch(/>\d+<\/text>/);
		expect(command.image).toContain("OFFLINE");
		expect(command.image).toContain('opacity="0.45"');
		d.press("s");
		d.press("c");
		await settle();
		expect(d.calls).toEqual([]);

		d.state.snapshot = session();
		await d.controller.refresh();
		expect(summary.image).toContain(">4</text>");
		expect(command.image).toContain("&gt; api-server");
	});
});

describe("spaces grid and pins", () => {
	test("control keys among space keys never take a slot", async () => {
		const d = await deck();
		const first = d.place("a", "space", 0, 0);
		d.place("c", "command", 1, 0, { command: "/review" });
		const second = d.place("b", "space", 2, 0);
		d.place("s", "summary", 3, 0);
		expect(first.image).toContain("api-server");
		expect(second.image).toContain("webapp");
		d.press("b");
		await settle();
		expect(d.calls).toEqual([["focusWorkspace", "w2"]]);
	});

	test("a failed refresh bumps trust, so a pin needs its name again", async () => {
		const d = await deck();
		const key = d.place("c", "command", 0, 0, { command: "/review", target: "w3", targetLabel: "docs" });
		const restarted = session();
		restarted.workspaces[2].label = "billing";
		d.state.snapshot = new Error("herdr socket closed");
		await d.controller.refresh();
		d.state.snapshot = restarted;
		await d.controller.refresh();
		expect(key.image).toContain("GONE");
	});
});
