import type { JsonObject } from "@elgato/utils";

import { parseActivity } from "./activity";
import { type ControlKind, controlFace, type ControlSettings, type Flash, pressControl } from "./controls";
import { type Bridge, gitInfoFor, raiseClient, type Snapshot, workingDir, type Workspace } from "./herdr";
import { cycleValues } from "./keys";
import { Assignment, clamp, pageCount, pageOf, pagerActive, pageSize, visibleRange } from "./layout";
import {
	connectingTile,
	controlTile,
	emptyTile,
	infobarImage,
	newSpaceTile,
	noSpacesTile,
	offlineTile,
	pagerTile,
	spaceTile,
	type SummaryLook,
	summaryTile,
} from "./render";
import { Backoff, Coalescer, pollDue, SUBSCRIBE_BACKOFF_CAP_TICKS } from "./schedule";
import { attentionQueue, countStates, resolveTarget, spaceName, type Target } from "./state";

const OFFLINE_AFTER_FAILURES = 3;
const COUNTDOWN_REFRESH_TICKS = 15;
const FOCUS_PENDING_TIMEOUT_MS = 5000;
const FOCUS_FAILURE_FLASH_MS = 1000;
const FLASH_OK_MS = 900;
const FLASH_FAIL_MS = 1500;
const EVENT_DEBOUNCE_MS = 75;
const EVENT_MIN_GAP_MS = 300;
export const INFOBAR_LAYOUT = "layouts/neo-summary.json";

export type KeyKind = ControlKind | "newSpace" | "space" | "summary";

/** The parts of a Stream Deck key action the controller drives. */
export type KeyHandle = {
	readonly coordinates?: Readonly<{ column: number; row: number }>;
	setImage(image?: string): Promise<void>;
	setSettings(settings: JsonObject): Promise<void>;
	showAlert(): Promise<void>;
};

/** The parts of a Stream Deck Neo Infobar action the controller drives. */
export type InfobarHandle = {
	setFeedback(feedback: { canvas: string }): Promise<void>;
	setFeedbackLayout(layout: string): Promise<void>;
};

export type BridgeLike = Pick<
	Bridge,
	| "createTab"
	| "createWorkspace"
	| "focusWorkspace"
	| "promptAgent"
	| "sendInput"
	| "sendKeys"
	| "sendText"
	| "snapshot"
	| "subscribeChanges"
>;

export type Logger = { error(message: string): void; info(message: string): void };

export type ControllerOptions = {
	bridge: BridgeLike;
	log: Logger;
	raise?: () => Promise<void>;
	/** Run the 1 Hz poll/subscribe loop; tests drive refresh() instead. */
	tick?: boolean;
};

type Role = "inert" | "newSpace" | "pagerLeft" | "pagerRight" | "space";

type Instance = {
	handle: KeyHandle;
	column: number;
	kind: KeyKind;
	row: number;
	settings: JsonObject;
};

const CONTROL_KINDS: ReadonlySet<KeyKind> = new Set<KeyKind>(["command", "cycle", "keys", "newtab", "text"]);

function isControl(kind: KeyKind): kind is ControlKind {
	return CONTROL_KINDS.has(kind);
}

/**
 * Mirrors the Herdr session onto every participating key: the spaces grid
 * (stable slots, state backgrounds, the dynamic two-key pager), the summary
 * keys and Infobars, and the control keys. Keys opt in by carrying an
 * action; the grid only ever uses keys carrying the Herdr Space action.
 */
export class DeckController {
	private readonly assigned = new Map<string, string>();
	private readonly assignment = new Assignment();
	private readonly bridge: BridgeLike;
	private readonly cycleIndex = new Map<string, number>();
	private readonly downs = new Set<string>();
	/** Bumped whenever herdr may have restarted, which can reuse workspace ids. */
	private epoch = 0;
	private everConnected = false;
	private failedUntil = 0;
	private failedWS = "";
	private failures = 0;
	private readonly flashes = new Map<string, { flash: Flash; until: number }>();
	private readonly infobars = new Map<string, InfobarHandle>();
	private readonly instances = new Map<string, Instance>();
	private lastFocusedWS = "";
	private readonly log: Logger;
	private page = 0;
	private pendingFocusWS = "";
	private pendingSince = 0;
	private polling = false;
	private readonly raise: () => Promise<void>;
	private readonly refreshSoon = new Coalescer(EVENT_DEBOUNCE_MS, () => void this.poll(), EVENT_MIN_GAP_MS);
	private readonly rendered = new Map<string, string>();
	private readonly resubscribe = new Backoff(SUBSCRIBE_BACKOFF_CAP_TICKS);
	private readonly roles = new Map<string, Role>();
	private sending: Promise<void> = Promise.resolve();
	private snapshot: Snapshot | undefined;
	private subscribeFailing = false;
	private subscribed = false;
	private subscribing = false;
	private readonly summaryTargets = new Map<string, string>();
	private ticks = 0;
	private ticksSincePoll = 0;
	/** Pinned keys whose workspace id has been seen continuously, as "id@epoch". */
	private readonly verified = new Map<string, string>();

	constructor(opts: ControllerOptions) {
		this.bridge = opts.bridge;
		this.log = opts.log;
		this.raise = opts.raise ?? raiseClient;
		if (opts.tick !== false) {
			setInterval(() => this.tick(), 1000);
		}
	}

	public add(id: string, handle: KeyHandle, kind: KeyKind, settings: JsonObject = {}): void {
		const coordinates = handle.coordinates ?? { column: 0, row: 0 };
		this.instances.set(id, { handle, column: coordinates.column, kind, row: coordinates.row, settings });
		if (kind === "cycle" && !this.cycleIndex.has(id)) {
			const index = (settings as ControlSettings).index;
			this.cycleIndex.set(id, Number.isInteger(index) && index! >= 0 ? index! : 0);
		}
		this.rendered.delete(id);
		this.render();
	}

	public addInfobar(id: string, handle: InfobarHandle): void {
		this.infobars.set(id, handle);
		this.rendered.delete(id);
		handle.setFeedbackLayout(INFOBAR_LAYOUT).then(
			() => this.render(),
			(err) => this.log.error(`infobar layout failed: ${err}`),
		);
	}

	public keyDown(id: string): void {
		this.downs.add(id);
	}

	/** Acts once per press; a key-up without its key-down is ignored. */
	public keyUp(id: string): void {
		if (!this.downs.delete(id)) {
			return;
		}
		const inst = this.instances.get(id);
		if (!inst) {
			return;
		}
		if (inst.kind === "summary") {
			this.pressSummary(id);
			return;
		}
		if (isControl(inst.kind)) {
			this.pressControl(id, inst, inst.kind);
			return;
		}
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
				if (workspaceId) {
					this.startFocus(workspaceId);
				}
				break;
			}
			case "newSpace":
				void this.createWorkspace(id);
				break;
			default:
				break;
		}
	}

	/** Snapshot-backed refresh, awaited by tests. */
	public async refresh(): Promise<void> {
		await this.poll();
	}

	public remove(id: string): void {
		this.instances.delete(id);
		this.infobars.delete(id);
		this.rendered.delete(id);
		this.roles.delete(id);
		this.assigned.delete(id);
		this.downs.delete(id);
		this.flashes.delete(id);
		this.verified.delete(id);
		this.summaryTargets.delete(id);
		this.render();
	}

	public updateSettings(id: string, settings: JsonObject): void {
		const inst = this.instances.get(id);
		if (!inst) {
			return;
		}
		inst.settings = settings;
		this.render();
	}

	/** Pin choices for the property inspector, named exactly as targets store them. */
	public workspaceItems(): { label: string; value: string }[] {
		if (!this.snapshot) {
			return [];
		}
		return sortedSpaces(this.snapshot).map((space) => ({ label: spaceName(space), value: space.workspace_id }));
	}

	private activeFlash(id: string): Flash | undefined {
		const entry = this.flashes.get(id);
		if (entry && Date.now() < entry.until) {
			return entry.flash;
		}
		this.flashes.delete(id);
		return undefined;
	}

	private async createWorkspace(id: string): Promise<void> {
		try {
			await this.bridge.createWorkspace();
			await this.raise();
		} catch (err) {
			await this.instances.get(id)?.handle.showAlert();
			this.log.error(`create workspace failed: ${err}`);
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
				() => this.refreshSoon.trigger(),
				() => {
					this.subscribed = false;
					this.epoch++;
				},
			)
			.then(
				() => {
					this.subscribed = true;
					this.subscribing = false;
					this.subscribeFailing = false;
					this.resubscribe.reset();
					this.log.info("herdr: subscribed to session events");
					this.refreshSoon.trigger();
				},
				(err) => {
					this.subscribing = false;
					this.resubscribe.failure();
					if (!this.subscribeFailing) {
						this.subscribeFailing = true;
						this.log.info(`herdr: event subscription failed, polling instead: ${err}`);
					}
				},
			);
	}

	private flash(id: string, flash: Flash): void {
		const ms = flash.ok ? FLASH_OK_MS : FLASH_FAIL_MS;
		this.flashes.set(id, { flash, until: Date.now() + ms });
		this.render();
		setTimeout(() => this.render(), ms + 50);
	}

	private async focus(workspaceId: string): Promise<void> {
		try {
			await this.bridge.focusWorkspace(workspaceId);
			await this.raise();
		} catch (err) {
			this.pendingFocusWS = "";
			this.failedWS = workspaceId;
			this.failedUntil = Date.now() + FOCUS_FAILURE_FLASH_MS;
			this.render();
			this.log.error(`focus ${workspaceId} failed: ${err}`);
			setTimeout(() => this.render(), FOCUS_FAILURE_FLASH_MS + 100);
		}
	}

	/** FOCUSING… while a requested focus is unconfirmed, FAILED briefly after an error. */
	private focusFeedback(space: Workspace): { footer?: string; footerRed?: boolean } {
		const now = Date.now();
		if (space.workspace_id === this.failedWS && now < this.failedUntil) {
			return { footer: "FAILED · TRY AGAIN", footerRed: true };
		}
		if (space.workspace_id === this.pendingFocusWS && !space.focused && now - this.pendingSince < FOCUS_PENDING_TIMEOUT_MS) {
			return { footer: "FOCUSING…" };
		}
		return {};
	}

	private focusedWorkspaceId(): string {
		return this.snapshot?.workspaces.find((space) => space.focused)?.workspace_id ?? "";
	}

	private hasCountdown(): boolean {
		return Boolean(this.snapshot?.workspaces.some((space) => parseActivity(space.tokens)?.nextAt));
	}

	private orderedInstances(kind: KeyKind): [string, Instance][] {
		return [...this.instances.entries()]
			.filter(([, inst]) => inst.kind === kind)
			.sort(([, a], [, b]) => a.row - b.row || a.column - b.column);
	}

	private persist(id: string, inst: Instance, settings: JsonObject): void {
		inst.settings = settings;
		inst.handle.setSettings(settings).catch((err) => this.log.error(`save settings for ${id} failed: ${err}`));
	}

	private async poll(): Promise<void> {
		if (this.polling) {
			return;
		}
		this.polling = true;
		this.ticksSincePoll = 0;
		try {
			const snapshot = await this.bridge.snapshot();
			if (this.failures >= OFFLINE_AFTER_FAILURES) {
				this.log.info("herdr: reachable again");
			}
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
		} catch (err) {
			this.failures++;
			this.epoch++;
			// Keep the last good frame through two failed polls to avoid
			// flicker.
			if (this.failures === OFFLINE_AFTER_FAILURES) {
				this.log.info(`herdr: offline: ${err}`);
				this.render();
			}
		} finally {
			this.polling = false;
		}
	}

	private pressControl(id: string, inst: Instance, kind: ControlKind): void {
		if (!this.ready() || !this.snapshot) {
			return;
		}
		const target = this.targetFor(id, inst);
		if (!target.ok) {
			return;
		}
		const settings = inst.settings as ControlSettings;
		let cycleValue = "";
		if (kind === "cycle") {
			const values = cycleValues(settings.values ?? "");
			if (values.length === 0) {
				this.flash(id, { text: "NOT SET", ok: false });
				return;
			}
			const index = (this.cycleIndex.get(id) ?? 0) % values.length;
			cycleValue = values[index];
			const next = (index + 1) % values.length;
			this.cycleIndex.set(id, next);
			this.persist(id, inst, { ...inst.settings, index: next });
			this.render();
		}
		// One send at a time: herdr writes a prompt's Enter about 300 ms after
		// its text, so overlapping prompts would interleave in the agent's input.
		this.sending = this.sending.then(async () => {
			const flash = await pressControl(kind, settings, target, { bridge: this.bridge, raise: this.raise }, cycleValue);
			if (!flash.ok) {
				this.log.info(`${kind} press on ${target.pane.pane_id}: ${flash.text}`);
			}
			this.flash(id, flash);
		});
	}

	/** Jumps to the next workspace that needs attention: blocked, then done, then idle. */
	private pressSummary(id: string): void {
		if (!this.ready() || !this.snapshot) {
			return;
		}
		const next = attentionQueue(this.snapshot)[0];
		if (!next) {
			this.flash(id, { text: "ALL CLEAR", ok: true });
			return;
		}
		this.summaryTargets.set(id, next);
		this.startFocus(next);
	}

	private ready(): boolean {
		return this.everConnected && this.snapshot !== undefined && this.failures < OFFLINE_AFTER_FAILURES;
	}

	private render(): void {
		this.renderSpaces();
		this.renderSummaries();
		this.renderControls();
		this.renderInfobars();
	}

	private renderControls(): void {
		const connecting = !this.everConnected || this.snapshot === undefined;
		const offline = this.failures >= OFFLINE_AFTER_FAILURES;
		for (const [id, inst] of this.instances) {
			if (!isControl(inst.kind)) {
				continue;
			}
			const settings = inst.settings as ControlSettings;
			const index = this.cycleIndex.get(id) ?? 0;
			let target: Target | undefined;
			if (!connecting && !offline) {
				target = this.targetFor(id, inst);
			}
			const face = controlFace(inst.kind, settings, target, index, offline ? "OFFLINE" : "");
			const flash = this.activeFlash(id);
			this.setImage(id, inst, controlTile(flash ? { ...face, flash } : face));
		}
	}

	private renderInfobars(): void {
		const connecting = !this.everConnected || this.snapshot === undefined;
		const offline = this.failures >= OFFLINE_AFTER_FAILURES;
		let image: string;
		if (connecting) {
			image = infobarImage(null, { message: "HERDR · CONNECTING" });
		} else if (offline) {
			image = infobarImage(null, { dim: true, message: "HERDR OFFLINE" });
		} else {
			image = infobarImage(countStates(this.snapshot!));
		}
		for (const [id, handle] of this.infobars) {
			if (this.rendered.get(id) === image) {
				continue;
			}
			this.rendered.set(id, image);
			handle.setFeedback({ canvas: image }).catch(() => this.rendered.delete(id));
		}
	}

	private renderSpaces(): void {
		for (const key of this.roles.keys()) {
			this.roles.set(key, "inert");
		}
		this.assigned.clear();

		const ready = this.ready();
		for (const [id, inst] of this.orderedInstances("newSpace")) {
			if (ready) {
				this.roles.set(id, "newSpace");
			}
			this.setImage(id, inst, newSpaceTile(!ready));
		}
		const ordered = this.orderedInstances("space");
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
				Object.assign(opt, this.focusFeedback(space));
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

	private renderSummaries(): void {
		const connecting = !this.everConnected || this.snapshot === undefined;
		const offline = this.failures >= OFFLINE_AFTER_FAILURES;
		for (const [id, inst] of this.instances) {
			if (inst.kind !== "summary") {
				continue;
			}
			const look: SummaryLook = inst.settings.look === "list" ? "list" : "ring";
			let image: string;
			if (connecting) {
				image = summaryTile(null, look, { footer: "CONNECTING" });
			} else if (offline) {
				image = summaryTile(null, look, { dim: true, footer: "OFFLINE", footerRed: true });
			} else {
				const flash = this.activeFlash(id);
				const target = this.snapshot!.workspaces.find((space) => space.workspace_id === this.summaryTargets.get(id));
				const feedback = flash
					? { footer: flash.text, footerRed: !flash.ok }
					: target
						? this.focusFeedback(target)
						: {};
				image = summaryTile(countStates(this.snapshot!), look, feedback);
			}
			this.setImage(id, inst, image);
		}
	}

	private setImage(id: string, inst: Instance, image: string): void {
		if (this.rendered.get(id) === image) {
			return;
		}
		this.rendered.set(id, image);
		inst.handle.setImage(image).catch(() => this.rendered.delete(id));
	}

	private startFocus(workspaceId: string): void {
		this.pendingFocusWS = workspaceId;
		this.pendingSince = Date.now();
		this.render();
		void this.focus(workspaceId);
	}

	/**
	 * Resolves a control key's target and keeps its pin current: a re-pin
	 * after herdr reused the id, or the workspace's latest name while the id
	 * has been watched continuously.
	 */
	private targetFor(id: string, inst: Instance): Target {
		const settings = inst.settings as ControlSettings;
		const trusted = Boolean(settings.target) && this.verified.get(id) === `${settings.target}@${this.epoch}`;
		const target = resolveTarget(this.snapshot!, settings, trusted);
		if (target.ok && target.pinned) {
			const workspaceId = target.repin?.target ?? target.workspace.workspace_id;
			const name = spaceName(target.workspace);
			this.verified.set(id, `${workspaceId}@${this.epoch}`);
			if (settings.target !== workspaceId || settings.targetLabel !== name) {
				this.persist(id, inst, { ...inst.settings, target: workspaceId, targetLabel: name });
			}
		}
		return target;
	}

	private tick(): void {
		if (this.resubscribe.due()) {
			this.ensureSubscribed();
		}
		this.ticksSincePoll++;
		if (pollDue(this.subscribed, this.ticksSincePoll)) {
			void this.poll();
		}
		// Activity countdowns ("17M") age without any herdr event; repaint
		// periodically while one is on screen. Unchanged keys are
		// deduplicated by setImage.
		this.ticks++;
		if (this.ticks % COUNTDOWN_REFRESH_TICKS === 0 && this.hasCountdown()) {
			this.render();
		}
	}
}

function sortedSpaces(snapshot: Snapshot): Workspace[] {
	return [...snapshot.workspaces].sort((a, b) => a.number - b.number || a.workspace_id.localeCompare(b.workspace_id));
}
