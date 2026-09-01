import streamDeck, { type KeyAction } from "@elgato/streamdeck";

import { Bridge, gitInfoFor, raiseClient, type Snapshot, workingDir, type Workspace } from "./herdr";
import { Assignment, clamp, pageCount, pageOf, pagerActive, pageSize, visibleRange } from "./layout";
import { connectingTile, emptyTile, newSpaceTile, noSpacesTile, offlineTile, pagerTile, spaceTile } from "./render";
import { Backoff, Coalescer, pollDue, SUBSCRIBE_BACKOFF_CAP_TICKS } from "./schedule";

const OFFLINE_AFTER_FAILURES = 3;
const FOCUS_PENDING_TIMEOUT_MS = 5000;
const FOCUS_FAILURE_FLASH_MS = 1000;
const EVENT_DEBOUNCE_MS = 75;
const EVENT_MIN_GAP_MS = 300;

type Role = "inert" | "newSpace" | "pagerLeft" | "pagerRight" | "space";

type Instance = {
	action: KeyAction;
	column: number;
	isNewSpace: boolean;
	row: number;
};

/**
 * Mirrors the Herdr session onto every participating key: stable slots,
 * state backgrounds, the dynamic two-key pager, and focus dispatch. One
 * controller serves both actions; keys opt in by carrying an action.
 */
export class DeckController {
	private readonly assigned = new Map<string, string>();
	private readonly assignment = new Assignment();
	private readonly bridge = new Bridge();
	private everConnected = false;
	private failedUntil = 0;
	private failedWS = "";
	private failures = 0;
	private readonly instances = new Map<string, Instance>();
	private lastFocusedWS = "";
	private page = 0;
	private pendingFocusWS = "";
	private pendingSince = 0;
	private polling = false;
	private readonly refresh = new Coalescer(EVENT_DEBOUNCE_MS, () => void this.poll(), EVENT_MIN_GAP_MS);
	private readonly rendered = new Map<string, string>();
	private readonly resubscribe = new Backoff(SUBSCRIBE_BACKOFF_CAP_TICKS);
	private readonly roles = new Map<string, Role>();
	private snapshot: Snapshot | undefined;
	private subscribed = false;
	private subscribing = false;
	private ticksSincePoll = 0;

	constructor() {
		setInterval(() => this.tick(), 1000);
	}

	public add(id: string, action: KeyAction, isNewSpace: boolean): void {
		const coordinates = action.coordinates ?? { column: 0, row: 0 };
		this.instances.set(id, { action, column: coordinates.column, isNewSpace, row: coordinates.row });
		this.rendered.delete(id);
		this.render();
	}

	public keyUp(id: string): void {
		switch (this.roles.get(id)) {
			case "pagerLeft":
				this.page--;
				this.render();
				break;
			case "pagerRight":
				this.page++;
				this.render();
				break;
			case "space": {
				const workspaceId = this.assigned.get(id);
				if (!workspaceId) {
					return;
				}
				this.pendingFocusWS = workspaceId;
				this.pendingSince = Date.now();
				this.render();
				void this.focus(workspaceId);
				break;
			}
			case "newSpace":
				void this.createWorkspace(id);
				break;
			default:
				break;
		}
	}

	public remove(id: string): void {
		this.instances.delete(id);
		this.rendered.delete(id);
		this.roles.delete(id);
		this.assigned.delete(id);
		this.render();
	}

	private async createWorkspace(id: string): Promise<void> {
		try {
			await this.bridge.createWorkspace();
			await raiseClient();
		} catch (err) {
			await this.instances.get(id)?.action.showAlert();
			streamDeck.logger.error(`create workspace failed: ${err}`);
		}
	}

	/**
	 * Keeps the event subscription alive; while it is down the 1 Hz tick
	 * both polls and doubles as the resubscribe retry loop.
	 */
	private ensureSubscribed(): void {
		if (this.subscribed || this.subscribing) {
			return;
		}
		this.subscribing = true;
		this.bridge
			.subscribeChanges(
				() => this.refresh.trigger(),
				() => {
					this.subscribed = false;
				},
			)
			.then(
				() => {
					this.subscribed = true;
					this.subscribing = false;
					this.resubscribe.reset();
					this.refresh.trigger();
				},
				() => {
					this.subscribing = false;
					this.resubscribe.failure();
				},
			);
	}

	private async focus(workspaceId: string): Promise<void> {
		try {
			await this.bridge.focusWorkspace(workspaceId);
			await raiseClient();
		} catch (err) {
			this.pendingFocusWS = "";
			this.failedWS = workspaceId;
			this.failedUntil = Date.now() + FOCUS_FAILURE_FLASH_MS;
			this.render();
			streamDeck.logger.error(`focus ${workspaceId} failed: ${err}`);
			setTimeout(() => this.render(), FOCUS_FAILURE_FLASH_MS + 100);
		}
	}

	private focusedWorkspaceId(): string {
		return this.snapshot?.workspaces.find((space) => space.focused)?.workspace_id ?? "";
	}

	private orderedInstances(): [string, Instance][] {
		return [...this.instances.entries()].sort(([, a], [, b]) => a.row - b.row || a.column - b.column);
	}

	private async poll(): Promise<void> {
		if (this.polling) {
			return;
		}
		this.polling = true;
		this.ticksSincePoll = 0;
		try {
			const snapshot = await this.bridge.snapshot();
			this.failures = 0;
			this.everConnected = true;
			this.snapshot = snapshot;
			if (this.pendingFocusWS) {
				const arrived = this.focusedWorkspaceId() === this.pendingFocusWS;
				if (arrived || Date.now() - this.pendingSince > FOCUS_PENDING_TIMEOUT_MS) {
					this.pendingFocusWS = "";
				}
			}
			this.render();
		} catch {
			this.failures++;
			// Keep the last good frame through two failed polls to avoid
			// flicker.
			if (this.failures === OFFLINE_AFTER_FAILURES) {
				this.render();
			}
		} finally {
			this.polling = false;
		}
	}

	private render(): void {
		const all = this.orderedInstances();
		if (all.length === 0) {
			return;
		}
		for (const key of this.roles.keys()) {
			this.roles.set(key, "inert");
		}
		this.assigned.clear();

		const ready = this.everConnected && this.snapshot !== undefined && this.failures < OFFLINE_AFTER_FAILURES;
		const ordered: [string, Instance][] = [];
		for (const [id, inst] of all) {
			if (inst.isNewSpace) {
				if (ready) {
					this.roles.set(id, "newSpace");
				}
				this.setImage(id, inst, newSpaceTile(!ready));
				continue;
			}
			ordered.push([id, inst]);
		}
		if (ordered.length === 0) {
			return;
		}

		if (!this.everConnected || this.snapshot === undefined) {
			this.setImage(...ordered[0], connectingTile());
			for (const [id, inst] of ordered.slice(1)) {
				this.setImage(id, inst, emptyTile());
			}
			return;
		}

		const offline = this.failures >= OFFLINE_AFTER_FAILURES;
		const spaces = sortedSpaces(this.snapshot);
		if (spaces.length === 0 && !offline) {
			this.setImage(...ordered[0], noSpacesTile());
			for (const [id, inst] of ordered.slice(1)) {
				this.setImage(id, inst, emptyTile());
			}
			return;
		}

		const byId = new Map(spaces.map((space) => [space.workspace_id, space]));
		const slots = this.assignment.update(spaces.map((space) => space.workspace_id));

		const keys = ordered.length;
		const pagerOn = pagerActive(slots.length, keys);
		const size = pageSize(keys, pagerOn);
		const count = pageCount(slots.length, size);

		const focusedWS = this.focusedWorkspaceId();
		if (focusedWS && focusedWS !== this.lastFocusedWS) {
			const index = slots.indexOf(focusedWS);
			if (index >= 0) {
				this.page = pageOf(index, size);
			}
		}
		this.lastFocusedWS = focusedWS;
		this.page = clamp(this.page, count);

		const focusedIndex = slots.indexOf(focusedWS);
		const [start, end] = visibleRange(this.page, size, slots.length);
		const visible = slots.slice(start, end);

		const contentKeys = pagerOn ? ordered.slice(0, keys - 2) : ordered;
		for (const [i, [id, inst]] of contentKeys.entries()) {
			if (i >= visible.length) {
				this.setImage(id, inst, emptyTile());
				continue;
			}
			const space = byId.get(visible[i]) as Workspace;
			const opt = { dim: offline, footer: "", footerRed: false };
			if (!offline) {
				this.roles.set(id, "space");
				this.assigned.set(id, space.workspace_id);
				const now = Date.now();
				if (space.workspace_id === this.failedWS && now < this.failedUntil) {
					opt.footer = "FAILED · TRY AGAIN";
					opt.footerRed = true;
				} else if (
					space.workspace_id === this.pendingFocusWS &&
					!space.focused &&
					now - this.pendingSince < FOCUS_PENDING_TIMEOUT_MS
				) {
					opt.footer = "FOCUSING…";
				}
			}
			const info = gitInfoFor(workingDir(this.snapshot, space), () => this.render());
			this.setImage(id, inst, spaceTile(space, info, opt));
		}
		if (pagerOn) {
			const [leftId, left] = ordered[keys - 2];
			const [rightId, right] = ordered[keys - 1];
			const focusedPage = focusedIndex >= 0 ? pageOf(focusedIndex, size) : -1;
			if (!offline) {
				this.roles.set(leftId, "pagerLeft");
				this.roles.set(rightId, "pagerRight");
			}
			this.setImage(
				leftId,
				left,
				pagerTile(true, this.page + 1, count, focusedPage >= 0 && focusedPage < this.page, offline),
			);
			this.setImage(rightId, right, pagerTile(false, this.page + 1, count, focusedPage > this.page, offline));
		}
		if (offline) {
			this.setImage(...ordered[0], offlineTile());
		}
	}

	private setImage(id: string, inst: Instance, image: string): void {
		if (this.rendered.get(id) === image) {
			return;
		}
		this.rendered.set(id, image);
		inst.action.setImage(image).catch(() => this.rendered.delete(id));
	}

	private tick(): void {
		if (this.resubscribe.due()) {
			this.ensureSubscribed();
		}
		this.ticksSincePoll++;
		if (pollDue(this.subscribed, this.ticksSincePoll)) {
			void this.poll();
		}
	}
}

function sortedSpaces(snapshot: Snapshot): Workspace[] {
	return [...snapshot.workspaces].sort((a, b) => a.number - b.number || a.workspace_id.localeCompare(b.workspace_id));
}
