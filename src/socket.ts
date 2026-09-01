/**
 * Client for the herdr server's unix-socket API: newline-delimited JSON
 * request/response envelopes, plus dedicated event-stream connections
 * (the server rejects further requests on a subscribed connection).
 */
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 2500;

export type Subscription = Record<string, unknown> & { type: string };

export type SubscriptionEvent = { event: string; data: unknown };

type Envelope = {
	id?: string;
	result?: unknown;
	error?: { code?: string; message?: string };
	event?: string;
	data?: unknown;
};

/**
 * The herdr server socket for the default session, resolved the way herdr
 * itself does: HERDR_SOCKET_PATH wins, then XDG_CONFIG_HOME, then
 * ~/.config. Matching herdr's resolution keeps sandboxed sessions
 * (compat-check) isolated from the real one.
 */
export function defaultSocketPath(): string {
	const override = process.env.HERDR_SOCKET_PATH;
	if (override) {
		return override;
	}
	const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(configHome, "herdr", "herdr.sock");
}

function attachLineReader(socket: net.Socket, onLine: (envelope: Envelope) => void): void {
	let buf = "";
	socket.on("data", (chunk) => {
		buf += chunk.toString();
		for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
			const line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			try {
				onLine(JSON.parse(line) as Envelope);
			} catch {
				// Skip unparseable lines rather than poisoning the stream.
			}
		}
	});
}

function errorFrom(envelope: Envelope): Error {
	return new Error(envelope.error?.message ?? envelope.error?.code ?? "herdr socket error");
}

export class SocketClient {
	private nextId = 1;
	private readonly streams = new Set<net.Socket>();
	private readonly timeoutMs: number;

	constructor(
		private readonly path: string,
		opts?: { timeoutMs?: number },
	) {
		this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	public close(): void {
		for (const stream of this.streams) {
			stream.destroy();
		}
		this.streams.clear();
	}

	/**
	 * One connection per request: the server sends FIN right after each
	 * response, so a reused connection can silently swallow the next
	 * request written into it.
	 */
	public request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = `deck-${this.nextId++}`;
			const socket = net.connect(this.path);
			let settled = false;
			const finish = (outcome: () => void) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				outcome();
			};
			const timer = setTimeout(() => finish(() => reject(new Error(`herdr socket timeout: ${method}`))), this.timeoutMs);
			socket.on("error", (err) => finish(() => reject(err)));
			socket.on("close", () => finish(() => reject(new Error("herdr socket closed"))));
			attachLineReader(socket, (envelope) => {
				// The lone request on this connection: an error envelope is
				// ours even when the server could not echo the id.
				if (envelope.id === id || envelope.error) {
					finish(() => (envelope.error ? reject(errorFrom(envelope)) : resolve(envelope.result)));
				}
			});
			socket.write(JSON.stringify({ id, method, params }) + "\n");
		});
	}

	/**
	 * Opens a dedicated event-stream connection. Resolves once the server
	 * acknowledges with subscription_started; every event line then goes to
	 * onEvent, and onClose fires when the stream ends for any reason.
	 */
	public subscribe(
		subscriptions: Subscription[],
		onEvent: (event: SubscriptionEvent) => void,
		onClose: () => void,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const id = `deck-sub-${this.nextId++}`;
			const socket = net.connect(this.path);
			this.streams.add(socket);
			let started = false;
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("herdr socket timeout: events.subscribe"));
			}, this.timeoutMs);
			const settle = (err?: Error) => {
				clearTimeout(timer);
				if (err) {
					socket.destroy();
					reject(err);
				} else {
					started = true;
					resolve();
				}
			};
			socket.on("error", () => {});
			socket.on("close", () => {
				this.streams.delete(socket);
				if (started) {
					onClose();
				} else {
					settle(new Error("herdr socket closed before subscription started"));
				}
			});
			attachLineReader(socket, (envelope) => {
				// The subscribe is the only request on this connection, so a
				// pre-start error belongs to it even when the server could
				// not echo the id (herdr sends id "" when deserialization
				// fails, e.g. an unknown subscription type).
				if (envelope.id === id || (!started && envelope.error)) {
					settle(envelope.error ? errorFrom(envelope) : undefined);
				} else if (started && envelope.event) {
					onEvent({ event: envelope.event, data: envelope.data });
				}
			});
			socket.write(JSON.stringify({ id, method: "events.subscribe", params: { subscriptions } }) + "\n");
		});
	}

}
