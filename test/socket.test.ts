import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { defaultSocketPath, SocketClient } from "../src/socket";

type Request = { id: string; method: string; params: unknown };

type Server = {
	path: string;
	connections: number;
	close: () => void;
};

const cleanups: (() => void)[] = [];

afterEach(() => {
	while (cleanups.length > 0) {
		cleanups.pop()?.();
	}
});

/**
 * Starts a real unix-socket server speaking the herdr wire protocol:
 * newline-delimited JSON. onRequest receives each parsed request with the
 * socket so tests can script responses, events, or drops.
 */
function startServer(onRequest: (req: Request, socket: net.Socket) => void): Server {
	const dir = mkdtempSync(join(tmpdir(), "herdr-sock-"));
	const path = join(dir, "s.sock");
	const state: Server = {
		path,
		connections: 0,
		close: () => {
			server.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
	const server = net.createServer((socket) => {
		state.connections++;
		let buf = "";
		socket.on("data", (chunk) => {
			buf += chunk.toString();
			for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				onRequest(JSON.parse(line) as Request, socket);
			}
		});
		socket.on("error", () => {});
	});
	server.listen(path);
	cleanups.push(state.close);
	return state;
}

function reply(socket: net.Socket, envelope: unknown): void {
	socket.write(JSON.stringify(envelope) + "\n");
}

function client(path: string, timeoutMs = 250): SocketClient {
	const c = new SocketClient(path, { timeoutMs });
	cleanups.push(() => c.close());
	return c;
}

describe("defaultSocketPath", () => {
	const saved = { HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

	afterEach(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	test("honors HERDR_SOCKET_PATH, herdr's own socket override", () => {
		process.env.HERDR_SOCKET_PATH = "/sandbox/herdr.sock";
		expect(defaultSocketPath()).toBe("/sandbox/herdr.sock");
	});

	test("follows XDG_CONFIG_HOME like the herdr server does", () => {
		delete process.env.HERDR_SOCKET_PATH;
		process.env.XDG_CONFIG_HOME = "/sandbox/config";
		expect(defaultSocketPath()).toBe("/sandbox/config/herdr/herdr.sock");
	});

	test("defaults to ~/.config/herdr/herdr.sock", () => {
		delete process.env.HERDR_SOCKET_PATH;
		delete process.env.XDG_CONFIG_HOME;
		expect(defaultSocketPath()).toMatch(/\/\.config\/herdr\/herdr\.sock$/);
	});
});

describe("SocketClient.request", () => {
	test("resolves with the result from a success response", async () => {
		const server = startServer((req, socket) => {
			expect(req.method).toBe("ping");
			expect(req.params).toEqual({});
			reply(socket, { id: req.id, result: { type: "pong", protocol: 20 } });
		});
		await expect(client(server.path).request("ping", {})).resolves.toEqual({ type: "pong", protocol: 20 });
	});

	test("rejects with the server's message on an error response", async () => {
		const server = startServer((req, socket) => {
			reply(socket, { id: req.id, error: { code: "invalid_request", message: "no such workspace" } });
		});
		await expect(client(server.path).request("workspace.focus", { workspace_id: "w9" })).rejects.toThrow(
			"no such workspace",
		);
	});

	test("correlates concurrent requests answered out of order", async () => {
		const pending: { id: string; socket: net.Socket }[] = [];
		const server = startServer((req, socket) => {
			pending.push({ id: req.id, socket });
			if (pending.length === 2) {
				for (const p of [...pending].reverse()) {
					reply(p.socket, { id: p.id, result: { answered: p.id } });
				}
			}
		});
		const c = client(server.path);
		const [a, b] = await Promise.all([c.request("agent.list", {}), c.request("pane.list", {})]);
		expect(a).not.toEqual(b);
		expect(pending.map((p) => p.id)).toEqual([
			(a as { answered: string }).answered,
			(b as { answered: string }).answered,
		]);
	});

	test("rejects in-flight requests when the server drops the connection", async () => {
		const server = startServer((_req, socket) => {
			socket.destroy();
		});
		await expect(client(server.path).request("ping", {})).rejects.toThrow();
	});

	test("reconnects for the next request after the server dropped the connection", async () => {
		let calls = 0;
		const server = startServer((req, socket) => {
			calls++;
			if (calls === 1) {
				socket.destroy();
				return;
			}
			reply(socket, { id: req.id, result: { ok: true } });
		});
		const c = client(server.path);
		await expect(c.request("ping", {})).rejects.toThrow();
		await expect(c.request("ping", {})).resolves.toEqual({ ok: true });
		expect(server.connections).toBe(2);
	});

	test("back-to-back requests succeed against a server that closes after each response", async () => {
		// The herdr server sends FIN right after answering; a request issued
		// immediately after the previous response must not be written into
		// the dying connection.
		const server = startServer((req, socket) => {
			reply(socket, { id: req.id, result: { seq: req.method } });
			socket.end();
		});
		const c = client(server.path);
		await expect(c.request("first", {})).resolves.toEqual({ seq: "first" });
		await expect(c.request("second", {})).resolves.toEqual({ seq: "second" });
		await expect(c.request("third", {})).resolves.toEqual({ seq: "third" });
	});

	test("rejects when nothing is listening on the socket path", async () => {
		const dir = mkdtempSync(join(tmpdir(), "herdr-sock-"));
		cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
		await expect(client(join(dir, "missing.sock")).request("ping", {})).rejects.toThrow();
	});

	test("rejects when the server never answers within the timeout", async () => {
		const server = startServer(() => {});
		await expect(client(server.path, 60).request("ping", {})).rejects.toThrow();
	});
});

describe("SocketClient.subscribe", () => {
	test("resolves after subscription_started and delivers subsequent events", async () => {
		const server = startServer((req, socket) => {
			expect(req.method).toBe("events.subscribe");
			expect(req.params).toEqual({ subscriptions: [{ type: "workspace.updated" }] });
			reply(socket, { id: req.id, result: { type: "subscription_started" } });
			reply(socket, { event: "workspace_updated", data: { workspace_id: "w1" } });
		});
		const events: unknown[] = [];
		let sawEvent: () => void = () => {};
		const arrived = new Promise<void>((resolve) => (sawEvent = resolve));
		await client(server.path).subscribe(
			[{ type: "workspace.updated" }],
			(event) => {
				events.push(event);
				sawEvent();
			},
			() => {},
		);
		await arrived;
		expect(events).toEqual([{ event: "workspace_updated", data: { workspace_id: "w1" } }]);
	});

	test("surfaces a pre-start error sent with an empty id, as real herdr does", async () => {
		// herdr cannot echo the request id when deserialization fails, so
		// invalid_request rejections arrive with id "" and then the server
		// closes the connection.
		const server = startServer((_req, socket) => {
			reply(socket, { id: "", error: { code: "invalid_request", message: "unknown variant `x`" } });
			socket.end();
		});
		await expect(
			client(server.path).subscribe([{ type: "x" }], () => {}, () => {}),
		).rejects.toThrow("unknown variant `x`");
	});

	test("rejects when the server answers the subscribe with an error", async () => {
		const server = startServer((req, socket) => {
			reply(socket, { id: req.id, error: { code: "invalid_request", message: "bad subscription" } });
		});
		await expect(
			client(server.path).subscribe([{ type: "workspace.updated" }], () => {}, () => {}),
		).rejects.toThrow("bad subscription");
	});

	test("fires onClose when the server closes the event stream", async () => {
		let stream: net.Socket | undefined;
		const server = startServer((req, socket) => {
			stream = socket;
			reply(socket, { id: req.id, result: { type: "subscription_started" } });
		});
		let closed: () => void = () => {};
		const closedP = new Promise<void>((resolve) => (closed = resolve));
		await client(server.path).subscribe([{ type: "workspace.updated" }], () => {}, closed);
		stream?.end();
		await closedP;
	});

	test("uses a dedicated connection separate from requests", async () => {
		const server = startServer((req, socket) => {
			if (req.method === "events.subscribe") {
				reply(socket, { id: req.id, result: { type: "subscription_started" } });
				return;
			}
			reply(socket, { id: req.id, result: { ok: true } });
		});
		const c = client(server.path);
		await c.request("ping", {});
		await c.subscribe([{ type: "workspace.updated" }], () => {}, () => {});
		expect(server.connections).toBe(2);
	});
});
