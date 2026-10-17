import { describe, expect, test } from "vitest";

import { cycleText, cycleValues, DEFAULT_KEYS, parseKeys } from "../src/keys";

describe("parseKeys", () => {
	test("defaults to an interrupt", () => {
		expect(parseKeys(DEFAULT_KEYS)).toEqual({ keys: ["esc"] });
	});

	test("normalises names and modifiers typed by a human", () => {
		expect(parseKeys("Ctrl+C")).toEqual({ keys: ["ctrl+c"] });
		expect(parseKeys("ESC")).toEqual({ keys: ["esc"] });
		expect(parseKeys("shift+tab, enter")).toEqual({ keys: ["shift+tab", "enter"] });
		expect(parseKeys("  up down,left  right ")).toEqual({ keys: ["up", "down", "left", "right"] });
		expect(parseKeys("Escape Return Space BackSpace F1 f12")).toEqual({
			keys: ["escape", "return", "space", "backspace", "f1", "f12"],
		});
		expect(parseKeys("control+d alt+Enter meta+x option+b shift+up ctrl+space ctrl+[")).toEqual({
			keys: ["control+d", "alt+enter", "meta+x", "option+b", "shift+up", "ctrl+space", "ctrl+["],
		});
	});

	test("keeps single characters verbatim", () => {
		expect(parseKeys("A")).toEqual({ keys: ["A"] });
		expect(parseKeys("y / é")).toEqual({ keys: ["y", "/", "é"] });
	});

	test("rejects keys herdr does not accept", () => {
		expect(parseKeys("S-Tab")).toEqual({ error: "unsupported key S-Tab" });
		expect(parseKeys("home")).toEqual({ error: "unsupported key home" });
		expect(parseKeys("esc, bogus")).toEqual({ error: "unsupported key bogus" });
		for (const token of ["f13", "f0", "ctrl+", "ctrl++", "ctrl+cc", "ctrl-c", "^c", "ctrl+shift+tab", "hyper+a", "<esc>"]) {
			expect(parseKeys(token)).toEqual({ error: `unsupported key ${token}` });
		}
	});

	test("rejects empty input", () => {
		expect(parseKeys("")).toEqual({ error: "no keys" });
		expect(parseKeys(" , \n")).toEqual({ error: "no keys" });
	});
});

describe("cycle", () => {
	test("values split on commas or newlines, trimmed, empties dropped", () => {
		expect(cycleValues("opus, sonnet,\nhaiku")).toEqual(["opus", "sonnet", "haiku"]);
		expect(cycleValues("  /clear \r\n\n, ,/compact,")).toEqual(["/clear", "/compact"]);
		expect(cycleValues("")).toEqual([]);
	});

	test("text joins command and value", () => {
		expect(cycleText("/model", "opus")).toBe("/model opus");
		expect(cycleText("", "/clear")).toBe("/clear");
		expect(cycleText(" /effort ", " high ")).toBe("/effort high");
	});
});
