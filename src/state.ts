/**
 * What the snapshot means for the summary and control keys: each
 * workspace's state, the counts across them, which workspace needs
 * attention next, and which pane a control key's press goes to.
 */
import { parseActivity } from "./activity";
import type { Pane, Snapshot, Workspace } from "./herdr";

export type SpaceState = "background" | "blocked" | "done" | "idle" | "none" | "scheduled" | "working";

export type Counts = Record<Exclude<SpaceState, "none">, number> & {
	total: number;
	nextAt: number | null;
	loop: boolean;
};

export type TargetSetting = { target?: string; targetLabel?: string };

export type Target =
	| {
			ok: true;
			pane: Pane;
			workspace: Workspace;
			pinned: boolean;
			footer: string;
			repin?: { target: string; targetLabel: string };
	  }
	| { ok: false; reason: "gone" | "none"; footer: string };

function noAgent(): Target {
	return { ok: false, reason: "none", footer: "NO AGENT" };
}

function gone(): Target {
	return { ok: false, reason: "gone", footer: "GONE" };
}

export function spaceName(space: Workspace): string {
	return space.label || `Space ${space.number}`;
}

function panesOf(snapshot: Snapshot, space: Workspace): Pane[] {
	return snapshot.panes.filter((pane) => pane.workspace_id === space.workspace_id);
}

export function spaceState(space: Workspace, snapshot: Snapshot): SpaceState {
	// herdr reports plain shells as "unknown"; only workspaces running an agent count.
	if (space.agent_status === "unknown" && !panesOf(snapshot, space).some((pane) => pane.agent)) {
		return "none";
	}
	if (space.agent_status === "blocked" || space.agent_status === "working") {
		return space.agent_status;
	}
	const activity = parseActivity(space.tokens);
	if (activity) {
		return activity.state === "scheduled" ? "scheduled" : "background";
	}
	return space.agent_status === "done" ? "done" : "idle";
}

export function countStates(snapshot: Snapshot): Counts {
	const counts: Counts = {
		blocked: 0,
		working: 0,
		background: 0,
		scheduled: 0,
		done: 0,
		idle: 0,
		total: 0,
		nextAt: null,
		loop: false,
	};
	for (const space of snapshot.workspaces) {
		const state = spaceState(space, snapshot);
		if (state === "none") {
			continue;
		}
		counts[state]++;
		counts.total++;
		const activity = parseActivity(space.tokens);
		if (activity?.nextAt != null && (counts.nextAt === null || activity.nextAt < counts.nextAt)) {
			counts.nextAt = activity.nextAt;
			counts.loop = activity.loop;
		}
	}
	return counts;
}

function byNumber(a: Workspace, b: Workspace): number {
	return a.number - b.number || a.workspace_id.localeCompare(b.workspace_id);
}

function focusedSpace(snapshot: Snapshot): Workspace | undefined {
	return (
		snapshot.workspaces.find((space) => space.workspace_id === snapshot.focused_workspace_id) ??
		snapshot.workspaces.find((space) => space.focused)
	);
}

export function attentionQueue(snapshot: Snapshot): string[] {
	const focusedId = focusedSpace(snapshot)?.workspace_id;
	const spaces = snapshot.workspaces.filter((space) => space.workspace_id !== focusedId).sort(byNumber);
	const queue: string[] = [];
	for (const wanted of ["blocked", "done", "idle"] as const) {
		for (const space of spaces) {
			if (spaceState(space, snapshot) === wanted) {
				queue.push(space.workspace_id);
			}
		}
	}
	return queue;
}

/**
 * The focused pane of a focused workspace; otherwise the pane its active
 * tab last focused, else its first pane. A plain shell gives way to the
 * workspace's agent when exactly one pane runs one.
 */
function targetPane(snapshot: Snapshot, space: Workspace, focused: boolean): Pane | undefined {
	const panes = panesOf(snapshot, space);
	const byId = (id: string | undefined) => (id ? panes.find((pane) => pane.pane_id === id) : undefined);
	const lastFocused = snapshot.layouts?.find((layout) => layout.tab_id === space.active_tab_id)?.focused_pane_id;
	const candidate = (focused ? byId(snapshot.focused_pane_id) : undefined) ?? byId(lastFocused) ?? panes[0];
	if (candidate && !candidate.agent) {
		const agents = panes.filter((pane) => pane.agent);
		if (agents.length === 1) {
			return agents[0];
		}
	}
	return candidate;
}

function pinnedSpace(
	snapshot: Snapshot,
	setting: TargetSetting,
	trustId: boolean,
): { space: Workspace; repin?: { target: string; targetLabel: string } } | undefined {
	const { target, targetLabel } = setting;
	const byId = snapshot.workspaces.find((space) => space.workspace_id === target);
	if (byId && (trustId || !targetLabel || spaceName(byId) === targetLabel)) {
		return { space: byId };
	}
	if (!targetLabel) {
		return undefined;
	}
	// Number-derived names ("Space 2") shift when herdr renumbers, so only a
	// real label can carry a pin to another workspace.
	const byLabel = snapshot.workspaces.filter((space) => space.label === targetLabel);
	if (byLabel.length !== 1) {
		return undefined;
	}
	return { space: byLabel[0], repin: { target: byLabel[0].workspace_id, targetLabel } };
}

/**
 * Herdr reuses workspace ids after a restart, so an untrusted pin only
 * holds while the stored label still matches. trustId says the caller has
 * watched this id continuously since it last matched, which covers a
 * label that drifts with the workspace's working directory.
 */
export function resolveTarget(snapshot: Snapshot, setting: TargetSetting, trustId = false): Target {
	const focused = focusedSpace(snapshot);
	if (!setting.target) {
		const pane = focused && targetPane(snapshot, focused, true);
		if (!focused || !pane) {
			return noAgent();
		}
		return { ok: true, pane, workspace: focused, pinned: false, footer: `> ${spaceName(focused)}` };
	}
	const pinned = pinnedSpace(snapshot, setting, trustId);
	if (!pinned) {
		return gone();
	}
	const { space, repin } = pinned;
	const pane = targetPane(snapshot, space, space === focused);
	if (!pane) {
		return noAgent();
	}
	return {
		ok: true,
		pane,
		workspace: space,
		pinned: true,
		footer: `#${space.number} ${spaceName(space)}`,
		...(repin ? { repin } : {}),
	};
}
