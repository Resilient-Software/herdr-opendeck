/**
 * Settings parsing for the Send Keys and Cycle actions. Key names follow
 * what herdr's pane.send_keys accepts; herdr rejects a whole request when
 * any key is unknown, so validation happens here, before a press.
 */

export const DEFAULT_KEYS = "esc";

const NAMED_KEYS = new Set([
	"esc",
	"escape",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIED = /^(?:ctrl|control|alt|meta|option|shift)\+(.+)$/;

function isSingleChar(token: string): boolean {
	return [...token].length === 1;
}

function normaliseKey(token: string): string | undefined {
	if (isSingleChar(token)) {
		return token;
	}
	const key = token.toLowerCase();
	if (NAMED_KEYS.has(key)) {
		return key;
	}
	const base = MODIFIED.exec(key)?.[1];
	if (base !== undefined && (NAMED_KEYS.has(base) || isSingleChar(base))) {
		return key;
	}
	return undefined;
}

export function parseKeys(input: string): { error: string } | { keys: string[] } {
	const tokens = input.split(/[\s,]+/).filter(Boolean);
	if (tokens.length === 0) {
		return { error: "no keys" };
	}
	const keys: string[] = [];
	for (const token of tokens) {
		const key = normaliseKey(token);
		if (key === undefined) {
			return { error: `unsupported key ${token}` };
		}
		keys.push(key);
	}
	return { keys };
}

export function cycleValues(values: string): string[] {
	return values
		.split(/[,\r\n]/)
		.map((value) => value.trim())
		.filter(Boolean);
}

export function cycleText(command: string, value: string): string {
	return `${command.trim()} ${value.trim()}`.trim();
}
