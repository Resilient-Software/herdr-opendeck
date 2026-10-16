import { describe, expect, test } from "vitest";

import type { Pane, Snapshot, Workspace } from "../src/herdr";
import { attentionQueue, countStates, resolveTarget, spaceName, spaceState } from "../src/state";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);

function space(workspace_id: string, number: number, overrides: Partial<Workspace> = {}): Workspace {
	return {
		workspace_id,
		number,
		label: `space-${number}`,
		agent_status: "idle",
		pane_count: 1,
		tab_count: 1,
		focused: false,
		worktree: null,
		...overrides,
	};
}

function pane(pane_id: string, overrides: Partial<Pane> = {}): Pane {
	return {
		pane_id,
		workspace_id: pane_id.split(":")[0],
		agent_status: "unknown",
		focused: false,
		...overrides,
	};
}

function agent(pane_id: string, overrides: Partial<Pane> = {}): Pane {
	return pane(pane_id, { agent: "claude", agent_status: "idle", ...overrides });
}

function snap(workspaces: Workspace[], panes: Pane[], extra: Partial<Snapshot> = {}): Snapshot {
	return { workspaces, panes, ...extra };
}

function schedule(minutes: number, loop: boolean) {
	return {
		rsact_v: "1",
		rsact_state: "scheduled",
		rsact_next_at: new Date(NOW + minutes * 60_000).toISOString(),
		rsact_loop: loop ? "1" : "0",
	};
}

const BACKGROUND = { rsact_v: "1", rsact_state: "background", rsact_background: "1" };
const SUBAGENTS = { rsact_v: "1", rsact_state: "subagents", rsact_subagents: "2" };

describe("spaceName", () => {
	test("label, else the workspace number", () => {
		expect(spaceName(space("w1", 1, { label: "api-server" }))).toBe("api-server");
		expect(spaceName(space("w3", 3, { label: "" }))).toBe("Space 3");
	});
});

describe("spaceState", () => {
	function stateOf(overrides: Partial<Workspace>, panes: Pane[] = [agent("w1:p1")]): string {
		const ws = space("w1", 1, overrides);
		return spaceState(ws, snap([ws], panes));
	}

	test("blocked and working beat activity", () => {
		expect(stateOf({ agent_status: "blocked", tokens: SUBAGENTS })).toBe("blocked");
		expect(stateOf({ agent_status: "working", tokens: schedule(5, true) })).toBe("working");
	});

	test("subagents and background work are background; a pending check alone is scheduled", () => {
		expect(stateOf({ agent_status: "idle", tokens: SUBAGENTS })).toBe("background");
		expect(stateOf({ agent_status: "done", tokens: BACKGROUND })).toBe("background");
		expect(stateOf({ agent_status: "idle", tokens: schedule(5, true) })).toBe("scheduled");
		expect(stateOf({ agent_status: "done", tokens: schedule(5, false) })).toBe("scheduled");
	});

	test("lifecycle states without activity", () => {
		expect(stateOf({ agent_status: "done" })).toBe("done");
		expect(stateOf({ agent_status: "idle" })).toBe("idle");
	});

	test("unknown counts only when some pane runs an agent", () => {
		expect(stateOf({ agent_status: "unknown" }, [pane("w1:p1")])).toBe("none");
		expect(stateOf({ agent_status: "unknown" }, [pane("w1:p1"), agent("w2:p1")])).toBe("none");
		expect(stateOf({ agent_status: "unknown" }, [pane("w1:p1"), agent("w1:p2")])).toBe("idle");
	});
});

describe("countStates", () => {
	test("counts agent workspaces and finds the soonest scheduled check", () => {
		const workspaces = [
			space("w1", 1, { label: "api-server", agent_status: "blocked" }),
			space("w2", 2, { label: "webapp", agent_status: "working" }),
			space("w3", 3, { label: "docs", agent_status: "idle", tokens: BACKGROUND }),
			space("w4", 4, { label: "infra", agent_status: "idle", tokens: schedule(10, true) }),
			space("w5", 5, { label: "search", agent_status: "done", tokens: schedule(4, false) }),
			space("w6", 6, { label: "billing", agent_status: "done" }),
			space("w7", 7, { label: "notes", agent_status: "idle" }),
			space("w8", 8, { label: "scratch", agent_status: "unknown", tokens: schedule(1, true) }),
		];
		const panes = [...workspaces.slice(0, 7).map((ws) => agent(`${ws.workspace_id}:p1`)), pane("w8:p1")];
		expect(countStates(snap(workspaces, panes))).toEqual({
			blocked: 1,
			working: 1,
			background: 1,
			scheduled: 2,
			done: 1,
			idle: 1,
			total: 7,
			nextAt: NOW + 4 * 60_000,
			loop: false,
		});
	});

	test("an empty session counts nothing", () => {
		expect(countStates(snap([], []))).toEqual({
			blocked: 0,
			working: 0,
			background: 0,
			scheduled: 0,
			done: 0,
			idle: 0,
			total: 0,
			nextAt: null,
			loop: false,
		});
	});
});

describe("attentionQueue", () => {
	test("blocked, then done, then idle, without the focused workspace", () => {
		const workspaces = [
			space("w1", 1, { agent_status: "done" }),
			space("w2", 2, { agent_status: "blocked", focused: true }),
			space("w3", 3, { agent_status: "blocked" }),
			space("w4", 4, { agent_status: "idle" }),
			space("w5", 5, { agent_status: "working" }),
			space("w6", 6, { agent_status: "idle", tokens: SUBAGENTS }),
			space("w7", 7, { agent_status: "unknown" }),
		];
		const panes = [...workspaces.slice(0, 6).map((ws) => agent(`${ws.workspace_id}:p1`)), pane("w7:p1")];
		expect(attentionQueue(snap(workspaces, panes, { focused_workspace_id: "w2" }))).toEqual(["w3", "w1", "w4"]);
	});

	test("orders by number and falls back to the focused flag", () => {
		const workspaces = [
			space("w2", 2, { agent_status: "done" }),
			space("w10", 1, { agent_status: "done" }),
			space("w4", 3, { agent_status: "done", focused: true }),
		];
		const panes = workspaces.map((ws) => agent(`${ws.workspace_id}:p1`));
		expect(attentionQueue(snap(workspaces, panes))).toEqual(["w10", "w2"]);
	});
});

describe("resolveTarget", () => {
	const focusedSnap = (panes: Pane[], focusedPane: string) =>
		snap([space("w1", 1, { label: "api-server", focused: true }), space("w2", 2, { label: "webapp" })], panes, {
			focused_workspace_id: "w1",
			focused_pane_id: focusedPane,
		});

	test("focused agent pane, blocked status included", () => {
		const target = resolveTarget(
			focusedSnap([agent("w1:p1", { focused: true, agent_status: "blocked" }), agent("w2:p1")], "w1:p1"),
			{},
		);
		expect(target).toMatchObject({ ok: true, pinned: false, footer: "> api-server" });
		expect(target.ok && target.pane.pane_id).toBe("w1:p1");
		expect(target.ok && target.pane.agent_status).toBe("blocked");
		expect(target.ok && target.workspace.workspace_id).toBe("w1");
		expect(target).not.toHaveProperty("repin");
	});

	test("focused shell with exactly one agent pane in the workspace targets the agent", () => {
		const target = resolveTarget(
			focusedSnap([pane("w1:p1", { focused: true }), agent("w1:p2", { agent: "codex" }), agent("w2:p1")], "w1:p1"),
			{ target: "" },
		);
		expect(target.ok && target.pane.pane_id).toBe("w1:p2");
	});

	test("focused shell with two agent panes stays on the shell", () => {
		const target = resolveTarget(
			focusedSnap([pane("w1:p1", { focused: true }), agent("w1:p2"), agent("w1:p3")], "w1:p1"),
			{},
		);
		expect(target.ok && target.pane.pane_id).toBe("w1:p1");
	});

	test("focused workspace from the focused flag when the top-level ids are missing", () => {
		const s = snap(
			[
				space("w1", 1, { label: "api-server" }),
				space("w2", 2, { label: "webapp", focused: true, active_tab_id: "w2:t1" }),
			],
			[agent("w1:p1"), agent("w2:p1"), agent("w2:p2")],
			{ layouts: [{ tab_id: "w2:t1", focused_pane_id: "w2:p2" }] },
		);
		const target = resolveTarget(s, {});
		expect(target).toMatchObject({ ok: true, footer: "> webapp" });
		expect(target.ok && target.pane.pane_id).toBe("w2:p2");
	});

	test("no workspaces means no agent", () => {
		expect(resolveTarget(snap([], []), {})).toEqual({ ok: false, reason: "none", footer: "NO AGENT" });
	});

	test("a workspace without panes means no agent", () => {
		expect(resolveTarget(snap([space("w1", 1, { focused: true })], []), {})).toEqual({
			ok: false,
			reason: "none",
			footer: "NO AGENT",
		});
	});

	describe("pinned", () => {
		const workspaces = [
			space("w1", 1, { label: "api-server", focused: true, active_tab_id: "w1:t1" }),
			space("w2", 2, { label: "webapp", active_tab_id: "w2:t2" }),
			space("w3", 3, { label: "docs" }),
		];
		const panes = [
			agent("w1:p1", { focused: true }),
			agent("w2:p1"),
			pane("w2:p2"),
			agent("w2:p3"),
			pane("w3:p1"),
			agent("w3:p2"),
		];
		const layouts = [
			{ tab_id: "w1:t1", focused_pane_id: "w1:p1" },
			{ tab_id: "w2:t1", focused_pane_id: "w2:p1" },
			{ tab_id: "w2:t2", focused_pane_id: "w2:p3" },
		];
		const pinnedSnap = snap(workspaces, panes, { focused_workspace_id: "w1", focused_pane_id: "w1:p1", layouts });

		test("uses the focused pane of the workspace's active tab", () => {
			const target = resolveTarget(pinnedSnap, { target: "w2", targetLabel: "webapp" });
			expect(target).toMatchObject({ ok: true, pinned: true, footer: "#2 webapp" });
			expect(target.ok && target.pane.pane_id).toBe("w2:p3");
			expect(target).not.toHaveProperty("repin");
		});

		test("without a layout, the first pane, redirected to the only agent", () => {
			const target = resolveTarget(pinnedSnap, { target: "w3", targetLabel: "docs" });
			expect(target.ok && target.pane.pane_id).toBe("w3:p2");
		});

		test("pinned to the focused workspace uses its focused pane", () => {
			const target = resolveTarget(pinnedSnap, { target: "w1", targetLabel: "api-server" });
			expect(target).toMatchObject({ ok: true, pinned: true, footer: "#1 api-server" });
			expect(target.ok && target.pane.pane_id).toBe("w1:p1");
		});

		test("a pin without a stored label matches by id alone", () => {
			const target = resolveTarget(pinnedSnap, { target: "w2" });
			expect(target).toMatchObject({ ok: true, footer: "#2 webapp" });
			expect(resolveTarget(pinnedSnap, { target: "w9" })).toEqual({ ok: false, reason: "gone", footer: "GONE" });
		});

		test("pinned id reused by a different workspace after a restart is GONE", () => {
			const restarted = snap(
				[space("w1", 1, { label: "api-server", focused: true }), space("w5", 2, { label: "infra" })],
				[agent("w1:p1", { focused: true }), agent("w5:p1")],
				{ focused_workspace_id: "w1", focused_pane_id: "w1:p1" },
			);
			expect(resolveTarget(restarted, { target: "w5", targetLabel: "docs" })).toEqual({
				ok: false,
				reason: "gone",
				footer: "GONE",
			});
		});

		test("pinned id gone but its label unique elsewhere re-pins", () => {
			const restarted = snap(
				[space("w5", 1, { label: "infra" }), space("w3", 2, { label: "docs" })],
				[agent("w5:p1"), agent("w3:p1")],
			);
			const target = resolveTarget(restarted, { target: "w5", targetLabel: "docs" });
			expect(target).toMatchObject({
				ok: true,
				pinned: true,
				footer: "#2 docs",
				repin: { target: "w3", targetLabel: "docs" },
			});
			expect(target.ok && target.pane.pane_id).toBe("w3:p1");
		});

		test("re-pins to an unnamed workspace by its number name", () => {
			const target = resolveTarget(snap([space("w4", 3, { label: "" })], [agent("w4:p1")]), {
				target: "w9",
				targetLabel: "Space 3",
			});
			expect(target).toMatchObject({ ok: true, footer: "#3 Space 3", repin: { target: "w4", targetLabel: "Space 3" } });
		});

		test("a label shared by several workspaces is GONE", () => {
			const duplicated = snap(
				[space("w3", 1, { label: "docs" }), space("w4", 2, { label: "docs" })],
				[agent("w3:p1"), agent("w4:p1")],
			);
			expect(resolveTarget(duplicated, { target: "w5", targetLabel: "docs" })).toEqual({
				ok: false,
				reason: "gone",
				footer: "GONE",
			});
		});

		test("a layout pane from another workspace is ignored", () => {
			const odd = snap(
				[space("w2", 1, { label: "webapp", active_tab_id: "w2:t1" })],
				[agent("w2:p1"), agent("w2:p2")],
				{ layouts: [{ tab_id: "w2:t1", focused_pane_id: "w7:p1" }] },
			);
			const target = resolveTarget(odd, { target: "w2", targetLabel: "webapp" });
			expect(target.ok && target.pane.pane_id).toBe("w2:p1");
		});
	});
});
