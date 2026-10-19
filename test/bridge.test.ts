import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Bridge, type Snapshot } from "../src/herdr";
import { HerdrApiError } from "../src/socket";

const SNAPSHOT: Snapshot = {
	focused_pane_id: "w1:p1",
	panes: [],
	workspaces: [
		{
			workspace_id: "w1",
			number: 1,
			label: "one",
			agent_status: "idle",
			pane_count: 1,
			tab_count: 1,
			focused: true,
			worktree: null,
		},
	],
};

type Request = { id: string; method: string; params: unknown };

const cleanups: (() => void)[] = [];
const savedPath = process.env.HERDR_PATH;

beforeEach(() => {
	process.env.HERDR_PATH = "/nonexistent/herdr";
});

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
	if (savedPath === undefined) {
		delete process.env.HERDR_PATH;
	} else {
		process.env.HERDR_PATH = savedPath;
	}
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "herdr-bridge-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** Serves the herdr socket protocol and records every request. */
function startServer(
	respond: (req: Request, socket: net.Socket) => void,
	path = join(tempDir(), "s.sock"),
): { path: string; requests: Request[] } {
	const requests: Request[] = [];
	const server = net.createServer((socket) => {
		socket.on("error", () => {});
		let buf = "";
		socket.on("data", (chunk) => {
			buf += chunk.toString();
			for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
				const req = JSON.parse(buf.slice(0, i)) as Request;
				buf = buf.slice(i + 1);
				requests.push(req);
				respond(req, socket);
			}
		});
	});
	server.listen(path);
	cleanups.push(() => server.close());
	return { path, requests };
}

/**
 * Installs a fake herdr CLI as HERDR_PATH that records every invocation's
 * arguments and answers `api snapshot` with the canned envelope. With
 * stderr set, every other command prints it to stderr and exits 1, the way
 * herdr reports API errors.
 */
function stubCli(opts?: { snapshot?: unknown; stderr?: string }): { record: string } {
	const dir = tempDir();
	const record = join(dir, "calls.txt");
	writeFileSync(record, "");
	const bin = join(dir, "herdr");
	const failure = opts?.stderr ? `cat "${dir}/stderr.txt" >&2\nexit 1` : `echo '{"id":"cli","result":{}}'`;
	writeFileSync(
		bin,
		`#!/bin/sh
echo "$@" >> "${record}"
if [ "$1" = "api" ] && [ "$2" = "snapshot" ]; then
  cat "${dir}/snapshot.json"
  exit 0
fi
${failure}
`,
	);
	chmodSync(bin, 0o755);
	writeFileSync(
		join(dir, "snapshot.json"),
		JSON.stringify(opts?.snapshot ?? { id: "cli", result: { snapshot: SNAPSHOT } }),
	);
	writeFileSync(join(dir, "stderr.txt"), opts?.stderr ?? "");
	process.env.HERDR_PATH = bin;
	return { record };
}

function cliCalls(record: string): string[] {
	return readFileSync(record, "utf8").split("\n").filter(Boolean);
}

function okServer(): { path: string; requests: Request[] } {
	return startServer((req, socket) => {
		socket.write(JSON.stringify({ id: req.id, result: { type: "ok" } }) + "\n");
	});
}

function deadSocketPath(): string {
	return join(tempDir(), "missing.sock");
}

describe("Bridge over the socket", () => {
	test("snapshot comes from session.snapshot without invoking the CLI", async () => {
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, result: { type: "session_snapshot", snapshot: SNAPSHOT } }) + "\n");
		});
		process.env.HERDR_PATH = "/nonexistent/herdr";
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await expect(bridge.snapshot()).resolves.toEqual(SNAPSHOT);
		expect(server.requests.map((r) => r.method)).toEqual(["session.snapshot"]);
		expect(bridge.transport).toEqual({ socket: 1, cli: 0 });
	});

	test("focusWorkspace sends workspace.focus with the workspace id", async () => {
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, result: {} }) + "\n");
		});
		process.env.HERDR_PATH = "/nonexistent/herdr";
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await bridge.focusWorkspace("w7");
		expect(server.requests).toMatchObject([{ method: "workspace.focus", params: { workspace_id: "w7" } }]);
	});

	test("createWorkspace sends workspace.create with focus", async () => {
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, result: {} }) + "\n");
		});
		process.env.HERDR_PATH = "/nonexistent/herdr";
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await bridge.createWorkspace();
		expect(server.requests).toMatchObject([{ method: "workspace.create", params: { focus: true } }]);
	});

	test("subscribeChanges drops pane_updated churn with deck-visible fields unchanged", async () => {
		const pane = (revision: number, status: string) => ({
			pane: {
				pane_id: "w1:p1",
				agent: "claude",
				agent_status: status,
				focused: false,
				cwd: "/repo",
				workspace_id: "w1",
				revision,
			},
		});
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, result: { type: "subscription_started" } }) + "\n");
			for (const [i, data] of [pane(1, "working"), pane(2, "working"), pane(3, "blocked")].entries()) {
				socket.write(JSON.stringify({ event: "pane_updated", data, seq: i }) + "\n");
			}
			socket.write(JSON.stringify({ event: "workspace_focused", data: { workspace_id: "w1" } }) + "\n");
			socket.end();
		});
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		let changes = 0;
		let closed: () => void = () => {};
		const closedP = new Promise<void>((resolve) => (closed = resolve));
		await bridge.subscribeChanges(() => changes++, closed);
		await closedP;
		// First sighting, the blocked flip, and the workspace focus fire; the
		// output-revision bump (2, "working") is churn and must not.
		expect(changes).toBe(3);
	});

	test("subscribeChanges passes agent activity token changes through the churn filter", async () => {
		const pane = (revision: number, summary: string | null) => ({
			pane: {
				pane_id: "w1:p1",
				agent: "claude",
				agent_status: "idle",
				focused: false,
				cwd: "/repo",
				workspace_id: "w1",
				revision,
				tokens: summary ? { rsact_v: "1", rsact_state: "background", rsact_summary: summary } : {},
			},
		});
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, result: { type: "subscription_started" } }) + "\n");
			const updates = [pane(1, null), pane(2, "1 bg"), pane(3, "1 bg"), pane(4, null)];
			for (const [i, data] of updates.entries()) {
				socket.write(JSON.stringify({ event: "pane_updated", data, seq: i }) + "\n");
			}
			socket.end();
		});
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		let changes = 0;
		let closed: () => void = () => {};
		const closedP = new Promise<void>((resolve) => (closed = resolve));
		await bridge.subscribeChanges(() => changes++, closed);
		await closedP;
		// First sighting, activity appearing, and activity clearing fire; the
		// repeat of "1 bg" is churn.
		expect(changes).toBe(3);
	});

	test("subscribeChanges retries with the server's supported subset (herdr 0.7.5)", async () => {
		const subCounts: number[] = [];
		const server = startServer((req, socket) => {
			const subs = (req.params as { subscriptions: { type: string }[] }).subscriptions;
			subCounts.push(subs.length);
			if (subs.some((s) => s.type === "workspace.reordered")) {
				const offered = subs
					.filter((s) => s.type !== "workspace.reordered")
					.map((s) => "`" + s.type + "`")
					.join(", ");
				// Real herdr loses the request id on deserialization failure:
				// the rejection carries id "" and the connection then closes.
				socket.write(
					JSON.stringify({
						id: "",
						error: {
							code: "invalid_request",
							message: `invalid request: unknown variant \`workspace.reordered\`, expected one of ${offered} at line 1 column 95`,
						},
					}) + "\n",
				);
				socket.end();
				return;
			}
			socket.write(JSON.stringify({ id: req.id, result: { type: "subscription_started" } }) + "\n");
			socket.write(JSON.stringify({ event: "workspace_focused", data: { workspace_id: "w1" } }) + "\n");
		});
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		let changes = 0;
		let sawChange: () => void = () => {};
		const changed = new Promise<void>((resolve) => (sawChange = resolve));
		await bridge.subscribeChanges(() => {
			changes++;
			sawChange();
		}, () => {});
		await changed;
		expect(changes).toBe(1);
		expect(subCounts.length).toBe(2);
		expect(subCounts[1]).toBe(subCounts[0] - 1);
	});

	test("subscribeChanges still rejects when the error names no usable subset", async () => {
		const server = startServer((req, socket) => {
			socket.write(
				JSON.stringify({ id: req.id, error: { code: "internal", message: "subscriptions unavailable" } }) + "\n",
			);
		});
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await expect(bridge.subscribeChanges(() => {}, () => {})).rejects.toThrow("subscriptions unavailable");
	});

	test("subscribeChanges reports each event and the stream closing", async () => {
		let stream: net.Socket | undefined;
		const server = startServer((req, socket) => {
			stream = socket;
			socket.write(JSON.stringify({ id: req.id, result: { type: "subscription_started" } }) + "\n");
			socket.write(JSON.stringify({ event: "workspace_updated", data: { workspace_id: "w1" } }) + "\n");
		});
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		let changes = 0;
		let sawChange: () => void = () => {};
		const changed = new Promise<void>((resolve) => (sawChange = resolve));
		let closed: () => void = () => {};
		const closedP = new Promise<void>((resolve) => (closed = resolve));
		await bridge.subscribeChanges(() => {
			changes++;
			sawChange();
		}, closed);
		await changed;
		expect(changes).toBe(1);
		stream?.end();
		await closedP;
	});
});

describe("Bridge CLI fallback", () => {
	test("snapshot falls back to the CLI when nothing listens on the socket", async () => {
		stubCli();
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await expect(bridge.snapshot()).resolves.toEqual(SNAPSHOT);
		expect(bridge.transport).toEqual({ socket: 0, cli: 1 });
	});

	test("snapshot propagates a socket API error without invoking the CLI", async () => {
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, error: { code: "invalid_request", message: "nope" } }) + "\n");
		});
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await expect(bridge.snapshot()).rejects.toMatchObject({ name: "HerdrApiError", code: "invalid_request" });
		expect(cliCalls(record)).toEqual([]);
	});

	test("snapshot keeps every field when the CLI places them directly under result", async () => {
		const flat: Snapshot = {
			...SNAPSHOT,
			focused_workspace_id: "w1",
			focused_tab_id: "w1:t1",
			tabs: [{ tab_id: "w1:t1", workspace_id: "w1", number: 1, label: "1", focused: true }],
			layouts: [{ tab_id: "w1:t1", focused_pane_id: "w1:p1" }],
		};
		stubCli({ snapshot: { id: "cli", result: flat } });
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await expect(bridge.snapshot()).resolves.toEqual(flat);
	});

	test("focusWorkspace falls back to the CLI command", async () => {
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await bridge.focusWorkspace("w3");
		expect(readFileSync(record, "utf8")).toContain("workspace focus w3");
	});

	test("createWorkspace falls back to the CLI command", async () => {
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await bridge.createWorkspace();
		expect(readFileSync(record, "utf8")).toContain("workspace create --focus");
	});

	test("subscribeChanges rejects when nothing listens, leaving polling in place", async () => {
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await expect(bridge.subscribeChanges(() => {}, () => {})).rejects.toThrow();
	});
});

describe("Bridge send and tab methods", () => {
	test("sendKeys sends pane.send_keys with the key list", async () => {
		const server = okServer();
		await new Bridge({ socketPath: server.path, timeoutMs: 250 }).sendKeys("w1:p1", ["esc"]);
		expect(server.requests.map(({ method, params }) => ({ method, params }))).toEqual([
			{ method: "pane.send_keys", params: { pane_id: "w1:p1", keys: ["esc"] } },
		]);
	});

	test("sendText sends pane.send_text with the literal text", async () => {
		const server = okServer();
		await new Bridge({ socketPath: server.path, timeoutMs: 250 }).sendText("w1:p1", "go ahead");
		expect(server.requests.map(({ method, params }) => ({ method, params }))).toEqual([
			{ method: "pane.send_text", params: { pane_id: "w1:p1", text: "go ahead" } },
		]);
	});

	test("sendInput sends pane.send_input with the text and Enter", async () => {
		const server = okServer();
		await new Bridge({ socketPath: server.path, timeoutMs: 250 }).sendInput("w1:p1", "npm test");
		expect(server.requests.map(({ method, params }) => ({ method, params }))).toEqual([
			{ method: "pane.send_input", params: { pane_id: "w1:p1", text: "npm test", keys: ["enter"] } },
		]);
	});

	test("promptAgent sends agent.prompt targeting the pane without waiting", async () => {
		const server = okServer();
		await new Bridge({ socketPath: server.path, timeoutMs: 250 }).promptAgent("w1:p1", "/review");
		expect(server.requests.map(({ method, params }) => ({ method, params }))).toEqual([
			{ method: "agent.prompt", params: { target: "w1:p1", text: "/review" } },
		]);
	});

	test("createTab sends tab.create focused in the given directory", async () => {
		const server = okServer();
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await bridge.createTab("w2", "/home/dev/webapp");
		await bridge.createTab("w2", undefined);
		expect(server.requests.map(({ method, params }) => ({ method, params }))).toEqual([
			{ method: "tab.create", params: { workspace_id: "w2", cwd: "/home/dev/webapp", focus: true } },
			{ method: "tab.create", params: { workspace_id: "w2", focus: true } },
		]);
	});

	test("HerdrApiError does not fall back to the CLI", async () => {
		const server = startServer((req, socket) => {
			socket.write(
				JSON.stringify({ id: req.id, error: { code: "agent_blocked", message: "agent w1:p1 is blocked" } }) + "\n",
			);
		});
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await expect(bridge.promptAgent("w1:p1", "/review")).rejects.toMatchObject({
			name: "HerdrApiError",
			code: "agent_blocked",
		});
		await expect(bridge.sendKeys("w1:p1", ["esc"])).rejects.toBeInstanceOf(HerdrApiError);
		await expect(bridge.focusWorkspace("w1")).rejects.toBeInstanceOf(HerdrApiError);
		expect(cliCalls(record)).toEqual([]);
	});

	test("transport failure falls back to the CLI", async () => {
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await bridge.sendKeys("w1:p1", ["esc"]);
		expect(cliCalls(record)).toEqual(["pane send-keys w1:p1 esc"]);
		expect(bridge.transport).toEqual({ socket: 0, cli: 1 });
	});

	test("each method maps to its CLI command on transport failure", async () => {
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		await bridge.sendKeys("w1:p1", ["shift+tab", "enter"]);
		await bridge.sendText("w1:p1", "-n go ahead");
		await bridge.sendInput("w1:p1", "npm test");
		await bridge.promptAgent("w1:p1", "/review");
		await bridge.createTab("w2", "/home/dev/webapp");
		await bridge.createTab("w2", undefined);
		expect(cliCalls(record)).toEqual([
			"pane send-keys w1:p1 shift+tab enter",
			"pane send-text w1:p1 -n go ahead",
			"pane run w1:p1 npm test",
			"agent prompt w1:p1 /review",
			"tab create --workspace w2 --cwd /home/dev/webapp --focus",
			"tab create --workspace w2 --focus",
		]);
	});

	test("a send that timed out after reaching the server is not repeated through the CLI", async () => {
		const server = startServer(() => {});
		const { record } = stubCli();
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 100 });
		await expect(bridge.promptAgent("w1:p1", "/review")).rejects.toThrow(/timeout/);
		await expect(bridge.sendKeys("w1:p1", ["esc"])).rejects.toThrow(/timeout/);
		await expect(bridge.createTab("w1", undefined)).rejects.toThrow(/timeout/);
		expect(server.requests.map((r) => r.method)).toEqual(["agent.prompt", "pane.send_keys", "tab.create"]);
		expect(cliCalls(record)).toEqual([]);
	});

	test("focusWorkspace still retries through the CLI after a socket timeout", async () => {
		const server = startServer(() => {});
		const { record } = stubCli();
		await new Bridge({ socketPath: server.path, timeoutMs: 100 }).focusWorkspace("w2");
		expect(cliCalls(record)).toEqual(["workspace focus w2"]);
	});

	test("CLI JSON error becomes HerdrApiError", async () => {
		stubCli({
			stderr: JSON.stringify({ id: "cli:request", error: { code: "pane_not_found", message: "pane w9:p9 not found" } }),
		});
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		const err = await bridge.sendText("w9:p9", "hello").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(HerdrApiError);
		expect(err).toMatchObject({ name: "HerdrApiError", code: "pane_not_found", message: "pane w9:p9 not found" });
	});

	test("CLI failure without a JSON envelope stays a plain error", async () => {
		stubCli({ stderr: "herdr: cannot connect to server" });
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		const err = await bridge.sendKeys("w1:p1", ["esc"]).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(HerdrApiError);
	});

	test("CLI server_not_running stays a plain error", async () => {
		stubCli({
			stderr: JSON.stringify({
				id: "cli:request",
				error: { code: "server_not_running", message: "no herdr server is running at h.sock" },
			}),
		});
		const bridge = new Bridge({ socketPath: deadSocketPath(), timeoutMs: 250 });
		const err = await bridge.sendKeys("w1:p1", ["esc"]).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(HerdrApiError);
	});

	test("logs a transport switch once per change", async () => {
		stubCli();
		const path = deadSocketPath();
		const lines: string[] = [];
		const bridge = new Bridge({ socketPath: path, timeoutMs: 250, log: (line) => lines.push(line) });
		await bridge.sendKeys("w1:p1", ["esc"]);
		await bridge.sendKeys("w1:p1", ["esc"]);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatch(/cli/i);
		startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, result: { type: "ok" } }) + "\n");
		}, path);
		await bridge.sendKeys("w1:p1", ["esc"]);
		await bridge.sendKeys("w1:p1", ["esc"]);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toMatch(/socket/i);
		expect(bridge.transport).toEqual({ socket: 2, cli: 2 });
	});
});
