import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Backoff, Coalescer, pollDue, RECONCILE_TICKS, SUBSCRIBE_BACKOFF_CAP_TICKS } from "../src/schedule";

describe("pollDue", () => {
	test("polls every tick while not subscribed", () => {
		expect(pollDue(false, 1)).toBe(true);
		expect(pollDue(false, 2)).toBe(true);
	});

	test("only reconciles every RECONCILE_TICKS ticks while subscribed", () => {
		for (let tick = 1; tick < RECONCILE_TICKS; tick++) {
			expect(pollDue(true, tick)).toBe(false);
		}
		expect(pollDue(true, RECONCILE_TICKS)).toBe(true);
	});
});

describe("Backoff", () => {
	/** Ticks consumed until due() returns true, counting that final tick. */
	function ticksUntilDue(backoff: Backoff, limit = 100): number {
		for (let tick = 1; tick <= limit; tick++) {
			if (backoff.due()) {
				return tick;
			}
		}
		return Infinity;
	}

	test("is due immediately before any failure", () => {
		expect(new Backoff(15).due()).toBe(true);
	});

	test("doubles the wait per consecutive failure up to the cap", () => {
		const backoff = new Backoff(15);
		const waits: number[] = [];
		for (let i = 0; i < 6; i++) {
			backoff.failure();
			waits.push(ticksUntilDue(backoff) - 1);
		}
		expect(waits).toEqual([1, 2, 4, 8, 15, 15]);
	});

	test("reset makes the next attempt due immediately", () => {
		const backoff = new Backoff(15);
		backoff.failure();
		backoff.failure();
		backoff.reset();
		expect(backoff.due()).toBe(true);
		backoff.failure();
		expect(ticksUntilDue(backoff) - 1).toBe(1);
	});

	test("cap constant keeps the worst-case retry at 15 ticks", () => {
		expect(SUBSCRIBE_BACKOFF_CAP_TICKS).toBe(15);
	});
});

describe("Coalescer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("fires once after the delay for a burst of triggers", () => {
		let fired = 0;
		const c = new Coalescer(75, () => fired++);
		c.trigger();
		c.trigger();
		c.trigger();
		expect(fired).toBe(0);
		vi.advanceTimersByTime(75);
		expect(fired).toBe(1);
	});

	test("fires again for a trigger after the previous fire", () => {
		let fired = 0;
		const c = new Coalescer(75, () => fired++);
		c.trigger();
		vi.advanceTimersByTime(75);
		c.trigger();
		vi.advanceTimersByTime(75);
		expect(fired).toBe(2);
	});

	test("holds a steady event stream to one fire per minimum gap", () => {
		let fired = 0;
		const c = new Coalescer(75, () => fired++, 300);
		// Events dripping every 100ms (the server's backlog replay pace) must
		// not fire per-event once the gap is in force.
		for (let t = 0; t < 1200; t += 100) {
			c.trigger();
			vi.advanceTimersByTime(100);
		}
		expect(fired).toBeLessThanOrEqual(4);
		expect(fired).toBeGreaterThanOrEqual(3);
	});

	test("a lone trigger after a quiet spell still fires at the debounce delay", () => {
		let fired = 0;
		const c = new Coalescer(75, () => fired++, 300);
		c.trigger();
		vi.advanceTimersByTime(75);
		expect(fired).toBe(1);
		vi.advanceTimersByTime(1000);
		c.trigger();
		vi.advanceTimersByTime(75);
		expect(fired).toBe(2);
	});

	test("cancel drops a pending fire", () => {
		let fired = 0;
		const c = new Coalescer(75, () => fired++);
		c.trigger();
		c.cancel();
		vi.advanceTimersByTime(200);
		expect(fired).toBe(0);
	});
});
