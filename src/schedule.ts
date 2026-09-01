/**
 * Poll cadence for the controller: while the event subscription is live,
 * polling drops to a slow reconciliation sweep (events trigger refreshes
 * instead); without it, every 1 Hz tick polls, matching the pre-socket
 * behaviour.
 */
export const RECONCILE_TICKS = 5;

export function pollDue(subscribed: boolean, ticksSincePoll: number): boolean {
	return subscribed ? ticksSincePoll >= RECONCILE_TICKS : true;
}

/**
 * Worst-case wait between subscription attempts, in 1 Hz ticks: 15 s. Old
 * servers that will never accept the subscription only see an occasional
 * connect instead of one per second.
 */
export const SUBSCRIBE_BACKOFF_CAP_TICKS = 15;

/**
 * Tick-driven exponential backoff: each failure doubles the wait before
 * due() allows the next attempt, up to the cap; reset() (on success)
 * clears it.
 */
export class Backoff {
	private delay = 0;
	private wait = 0;

	constructor(private readonly capTicks: number) {}

	/** Consumes one tick; true when an attempt may run now. */
	public due(): boolean {
		if (this.wait > 0) {
			this.wait--;
			return false;
		}
		return true;
	}

	public failure(): void {
		this.delay = Math.min(Math.max(this.delay * 2, 1), this.capTicks);
		this.wait = this.delay;
	}

	public reset(): void {
		this.delay = 0;
		this.wait = 0;
	}
}

/**
 * Collapses a burst of triggers into one deferred call, and holds a
 * sustained stream (the server replays an event backlog to fresh
 * subscribers) to at most one call per minGapMs.
 */
export class Coalescer {
	private lastFire = 0;
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly delayMs: number,
		private readonly fn: () => void,
		private readonly minGapMs = 0,
	) {}

	public cancel(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	public trigger(): void {
		if (this.timer !== undefined) {
			return;
		}
		const wait = Math.max(this.delayMs, this.lastFire + this.minGapMs - Date.now());
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.lastFire = Date.now();
			this.fn();
		}, wait);
	}
}
