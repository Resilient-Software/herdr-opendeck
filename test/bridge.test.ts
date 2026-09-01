import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { Bridge, type Snapshot } from "../src/herdr";

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
function startServer(respond: (req: Request, socket: net.Socket) => void): { path: string; requests: Request[] } {
	const path = join(tempDir(), "s.sock");
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
 * Installs a fake herdr CLI as HERDR_PATH: answers `api snapshot` with the
 * canned snapshot and records any other invocation's arguments.
 */
function stubCli(): { record: string } {
	const dir = tempDir();
	const record = join(dir, "calls.txt");
	writeFileSync(record, "");
	const bin = join(dir, "herdr");
	writeFileSync(
		bin,
		`#!/bin/sh
if [ "$1" = "api" ] && [ "$2" = "snapshot" ]; then
  cat "${dir}/snapshot.json"
  exit 0
fi
echo "$@" >> "${record}"
echo '{"id":"cli","result":{}}'
`,
	);
	chmodSync(bin, 0o755);
	writeFileSync(join(dir, "snapshot.json"), JSON.stringify({ id: "cli", result: { snapshot: SNAPSHOT } }));
	process.env.HERDR_PATH = bin;
	return { record };
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

	test("snapshot falls back to the CLI when the socket answers with an error", async () => {
		const server = startServer((req, socket) => {
			socket.write(JSON.stringify({ id: req.id, error: { code: "invalid_request", message: "nope" } }) + "\n");
		});
		stubCli();
		const bridge = new Bridge({ socketPath: server.path, timeoutMs: 250 });
		await expect(bridge.snapshot()).resolves.toEqual(SNAPSHOT);
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
