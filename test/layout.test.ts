import { describe, expect, it } from "vitest";

import { Assignment, clamp, pageCount, pageOf, pagerActive, pageSize, visibleRange } from "../src/layout";

describe("Assignment", () => {
	it("keeps survivors in stable slots", () => {
		const a = new Assignment();
		expect(a.update(["w1", "w2", "w3"])).toEqual(["w1", "w2", "w3"]);
		expect(a.update(["w9", "w2", "w3"])).toEqual(["w2", "w3", "w9"]);
		expect(a.update(["w9", "w2", "w3"])).toEqual(["w2", "w3", "w9"]);
	});

	it("compacts removals", () => {
		const a = new Assignment();
		a.update(["w1", "w2", "w3", "w4"]);
		expect(a.update(["w1", "w4"])).toEqual(["w1", "w4"]);
	});
});

describe("pager", () => {
	it("activates only when spaces exceed the keys", () => {
		expect(pagerActive(14, 14)).toBe(false);
		expect(pagerActive(15, 14)).toBe(true);
		expect(pagerActive(3, 2)).toBe(false);
	});

	it("pages with the two-key pager", () => {
		const keys = 14;
		const spaces = 15;
		const size = pageSize(keys, pagerActive(spaces, keys));
		expect(size).toBe(12);
		expect(pageCount(spaces, size)).toBe(2);
		expect(visibleRange(1, size, spaces)).toEqual([12, 15]);
		expect(pageOf(14, size)).toBe(1);
	});

	it("clamps the page", () => {
		expect(clamp(-1, 3)).toBe(0);
		expect(clamp(5, 3)).toBe(2);
		expect(clamp(1, 3)).toBe(1);
	});
});
