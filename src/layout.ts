/**
 * Pure key-assignment and paging logic, testable without a device or a
 * Herdr session.
 */

/**
 * Keeps surviving workspace IDs in their existing slots between polls:
 * removals compact, additions append in the order given.
 */
export class Assignment {
	private ids: string[] = [];

	public update(live: string[]): string[] {
		const liveSet = new Set(live);
		const kept: string[] = [];
		const seen = new Set<string>();
		for (const id of this.ids) {
			if (liveSet.has(id) && !seen.has(id)) {
				kept.push(id);
				seen.add(id);
			}
		}
		for (const id of live) {
			if (!seen.has(id)) {
				kept.push(id);
				seen.add(id);
			}
		}
		this.ids = kept;
		return kept;
	}
}

/** The pager takes the last two keys: a left arrow and a right arrow. */
export function pagerActive(spaces: number, keys: number): boolean {
	return keys > 2 && spaces > keys;
}

export function pageSize(keys: number, pagerOn: boolean): number {
	return pagerOn ? keys - 2 : keys;
}

export function pageCount(spaces: number, size: number): number {
	if (size <= 0 || spaces <= 0) {
		return 1;
	}
	return Math.ceil(spaces / size);
}

export function clamp(page: number, count: number): number {
	if (page < 0) {
		return 0;
	}
	if (page >= count) {
		return count - 1;
	}
	return page;
}

export function pageOf(index: number, size: number): number {
	if (size <= 0 || index < 0) {
		return 0;
	}
	return Math.floor(index / size);
}

/** The [start, end) slice bounds of spaces on a page. */
export function visibleRange(page: number, size: number, spaces: number): [number, number] {
	const start = Math.min(page * size, spaces);
	const end = Math.min(start + size, spaces);
	return [start, end];
}
