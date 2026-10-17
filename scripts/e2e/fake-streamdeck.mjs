/**
 * A fake Elgato Stream Deck host for end-to-end plugin tests.
 *
 * Speaks the plugin side of the Stream Deck SDK websocket protocol (the
 * shapes @elgato/streamdeck parses in dist/api/events and sends from
 * dist/api/command.d.ts): it spawns the plugin exactly as the Elgato app
 * does, waits for registerPlugin, then lets a test place actions
 * (willAppear), press keys (keyDown/keyUp), play the property inspector,
 * and inspect everything the plugin sent back (setImage, setTitle,
 * setSettings, showAlert, setFeedback, ...).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

import { WebSocketServer } from "ws";

/** A 15-key Stream Deck as the Elgato app reports it in -info. */
export const STREAM_DECK_15 = {
	id: "E2E0000000000000000000000000DECK",
	name: "Stream Deck",
	size: { columns: 5, rows: 3 },
	type: 0,
};

/** The -info registration JSON, shaped like the one the Elgato app passes. */
export function registrationInfo({ devices, pluginUUID, pluginVersion, appVersion = "7.5.1.22901" }) {
	return {
		application: {
			font: ".AppleSystemUIFont",
			language: "en",
			platform: "mac",
			platformVersion: release(),
			version: appVersion,
		},
		colors: {
			buttonPressedBackgroundColor: "#303030FF",
			buttonPressedBorderColor: "#646464FF",
			buttonPressedTextColor: "#969696FF",
			disabledColor: "#007AFF59",
			highlightColor: "#007AFFFF",
			mouseDownColor: "#005CD7FF",
		},
		devicePixelRatio: 2,
		devices,
		plugin: { uuid: pluginUUID, version: pluginVersion },
	};
}

/** Decodes a setImage data URL into { mime, ext, data: Buffer }. */
export function decodeDataUrl(url) {
	const match = /^data:([^;,]+)((?:;[^;,]+)*),(.*)$/s.exec(url ?? "");
	if (!match) {
		return null;
	}
	const [, mime, params, body] = match;
	const data = params.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
	const ext = mime === "image/svg+xml" ? "svg" : (mime.split("/")[1] ?? "bin");
	return { mime, ext, data };
}

export class FakeStreamDeck extends EventEmitter {
	/**
	 * @param {object} opts
	 * @param {string} opts.pluginDir  The .sdPlugin directory; becomes the plugin's cwd.
	 * @param {string} [opts.nodeBin]  Node binary; defaults to this process's.
	 * @param {string[]} [opts.nodeArgs] Flags before the script (the Elgato app uses
	 *   --no-global-search-paths --enable-source-maps).
	 * @param {Record<string,string>} [opts.env] Plugin environment (replaces, not merges).
	 * @param {object[]} [opts.devices] Devices for -info; default one 15-key Stream Deck.
	 * @param {string} [opts.appVersion]
	 */
	constructor(opts) {
		super();
		this.opts = opts;
		this.manifest = JSON.parse(readFileSync(join(opts.pluginDir, "manifest.json"), "utf8"));
		this.devices = opts.devices ?? [STREAM_DECK_15];
		this.registrationUUID = randomBytes(16).toString("hex");
		/** Every message both ways: { t, dir: "in" | "out", msg }. */
		this.log = [];
		/** Latest setImage per context, and how many arrived. */
		this.images = new Map();
		this.imageCounts = new Map();
		this.titles = new Map();
		/** Per-context settings as the host stores them. */
		this.settings = new Map();
		this.globalSettings = {};
		this.alerts = [];
		this.feedback = new Map();
		this.toPropertyInspector = [];
		this.placed = new Map();
		this.stdout = "";
		this.stderr = "";
		this.t0 = Date.now();
	}

	/** Starts the websocket server, spawns the plugin, resolves on registerPlugin. */
	async start(timeoutMs = 10000) {
		this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		await once(this.wss, "listening");
		const port = this.wss.address().port;
		const info = registrationInfo({
			devices: this.devices,
			pluginUUID: this.manifest.UUID,
			pluginVersion: this.manifest.Version,
			appVersion: this.opts.appVersion,
		});
		const args = [
			...(this.opts.nodeArgs ?? []),
			join(this.opts.pluginDir, this.manifest.CodePath),
			"-port",
			String(port),
			"-pluginUUID",
			this.registrationUUID,
			"-registerEvent",
			"registerPlugin",
			"-info",
			JSON.stringify(info),
		];
		this.child = spawn(this.opts.nodeBin ?? process.execPath, args, {
			cwd: this.opts.pluginDir,
			env: this.opts.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.child.stdout.on("data", (chunk) => (this.stdout += chunk));
		this.child.stderr.on("data", (chunk) => (this.stderr += chunk));
		this.exited = new Promise((resolve) => this.child.once("exit", (code, signal) => resolve({ code, signal })));

		const registered = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`no registerPlugin within ${timeoutMs} ms\n${this.stderr}`)), timeoutMs);
			this.wss.once("connection", (ws) => {
				this.ws = ws;
				ws.on("message", (raw) => this.#receive(raw.toString()));
				ws.on("pong", () => this.emit("pong"));
				this.once("registerPlugin", (msg) => {
					clearTimeout(timer);
					resolve(msg);
				});
			});
			this.exited.then(({ code, signal }) => reject(new Error(`plugin exited (${code ?? signal}) before registering\n${this.stderr}`)));
		});
		const msg = await registered;
		if (msg.uuid !== this.registrationUUID) {
			throw new Error(`registerPlugin uuid ${msg.uuid} != -pluginUUID ${this.registrationUUID}`);
		}
		return msg;
	}

	/** Places an action on a key, as a profile load or drag-in does. */
	willAppear({ context, action, coordinates, settings = {}, controller = "Keypad", device, state = 0 }) {
		const deviceId = device ?? this.devices[0].id;
		this.placed.set(context, { action, coordinates, controller, device: deviceId, state });
		this.settings.set(context, settings);
		this.send(this.#actionEvent("willAppear", context));
	}

	willDisappear(context) {
		this.send(this.#actionEvent("willDisappear", context));
		this.placed.delete(context);
	}

	keyDown(context) {
		this.send(this.#actionEvent("keyDown", context));
	}

	keyUp(context) {
		this.send(this.#actionEvent("keyUp", context));
	}

	/** A full press: keyDown, optional hold, keyUp. */
	async press(context, holdMs = 60) {
		this.keyDown(context);
		await sleep(holdMs);
		this.keyUp(context);
	}

	/** The property inspector opening for a key. */
	propertyInspectorDidAppear(context) {
		const { action, device } = this.placed.get(context);
		this.send({ action, context, device, event: "propertyInspectorDidAppear" });
	}

	/** A property inspector message (sendToPlugin has no device field). */
	sendToPlugin(context, payload) {
		const { action } = this.placed.get(context);
		this.send({ action, context, event: "sendToPlugin", payload });
	}

	/** The property inspector saving settings: the plugin gets didReceiveSettings without an id. */
	inspectorSetSettings(context, settings) {
		this.settings.set(context, settings);
		this.send(this.#actionEvent("didReceiveSettings", context));
	}

	deviceDidConnect(device) {
		this.devices.push(device);
		this.send({ event: "deviceDidConnect", device: device.id, deviceInfo: deviceInfo(device) });
	}

	deviceDidDisconnect(deviceId) {
		this.send({ event: "deviceDidDisconnect", device: deviceId });
	}

	systemDidWakeUp() {
		this.send({ event: "systemDidWakeUp" });
	}

	send(msg) {
		this.log.push({ t: Date.now() - this.t0, dir: "out", msg });
		this.ws.send(JSON.stringify(msg));
	}

	/** Websocket ping round trip in ms; the Elgato app's watchdog kills plugins that stop answering. */
	ping(timeoutMs = 5000) {
		return new Promise((resolve, reject) => {
			const start = performance.now();
			const onPong = () => {
				clearTimeout(timer);
				resolve(performance.now() - start);
			};
			const timer = setTimeout(() => {
				this.off("pong", onPong);
				reject(new Error("pong timeout"));
			}, timeoutMs);
			this.once("pong", onPong);
			this.ws.ping();
		});
	}

	/** Resolves with predicate()'s value once it is truthy; polls every 25 ms. */
	async waitFor(predicate, timeoutMs = 5000, what = "condition") {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const value = await predicate();
			if (value) {
				return value;
			}
			if (Date.now() > deadline) {
				throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
			}
			await sleep(25);
		}
	}

	/** Resolves when no setImage/setFeedback has arrived for quietMs. */
	async waitForQuiet(quietMs = 1200, timeoutMs = 10000) {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const last = this.lastPaintAt ?? 0;
			if (Date.now() - last >= quietMs) {
				return;
			}
			if (Date.now() > deadline) {
				throw new Error(`keys never went quiet for ${quietMs} ms`);
			}
			await sleep(100);
		}
	}

	/** The latest image for a context, decoded; svg text in .text. */
	image(context) {
		const decoded = decodeDataUrl(this.images.get(context));
		return decoded && { ...decoded, text: decoded.data.toString("utf8") };
	}

	/** Writes the latest image of every placed context to dir as <name>.<ext>. */
	dumpImages(dir, nameOf = (context) => context) {
		mkdirSync(dir, { recursive: true });
		const files = [];
		for (const context of this.placed.keys()) {
			const decoded = decodeDataUrl(this.images.get(context));
			if (!decoded) {
				continue;
			}
			const file = join(dir, `${nameOf(context)}.${decoded.ext}`);
			writeFileSync(file, decoded.data);
			files.push(file);
		}
		return files;
	}

	messagesFromPlugin(event) {
		return this.log.filter((entry) => entry.dir === "in" && (!event || entry.msg.event === event));
	}

	async stop() {
		try {
			this.ws?.close();
		} catch {
			// already closed
		}
		if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
			this.child.kill("SIGTERM");
			const killed = await Promise.race([this.exited, sleep(2000).then(() => null)]);
			if (!killed) {
				this.child.kill("SIGKILL");
				await this.exited;
			}
		}
		await new Promise((resolve) => this.wss?.close(resolve) ?? resolve());
	}

	#actionEvent(event, context) {
		const placed = this.placed.get(context);
		if (!placed) {
			throw new Error(`no action placed with context ${context}`);
		}
		const { action, coordinates, controller, device, state } = placed;
		const settings = this.settings.get(context) ?? {};
		const payload =
			controller === "Keypad"
				? { controller, coordinates, isInMultiAction: false, settings, state, resources: {} }
				: { controller, coordinates, settings, resources: {} };
		return { action, context, device, event, payload };
	}

	#receive(raw) {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			this.log.push({ t: Date.now() - this.t0, dir: "in", raw });
			return;
		}
		this.log.push({ t: Date.now() - this.t0, dir: "in", msg });
		const { context, event, payload } = msg;
		switch (event) {
			case "setImage":
				this.images.set(context, payload?.image);
				this.imageCounts.set(context, (this.imageCounts.get(context) ?? 0) + 1);
				this.lastPaintAt = Date.now();
				break;
			case "setTitle":
				this.titles.set(context, payload?.title);
				break;
			case "setSettings":
				// The real app does not echo plugin-side setSettings back as didReceiveSettings.
				this.settings.set(context, payload);
				break;
			case "getSettings":
				if (this.placed.has(context)) {
					this.send({ ...this.#actionEvent("didReceiveSettings", context), id: msg.id });
				}
				break;
			case "setGlobalSettings":
				this.globalSettings = payload;
				break;
			case "getGlobalSettings":
				this.send({ event: "didReceiveGlobalSettings", id: msg.id, payload: { settings: this.globalSettings } });
				break;
			case "getResources":
				if (this.placed.has(context)) {
					this.send({ ...this.#actionEvent("didReceiveResources", context), id: msg.id });
				}
				break;
			case "showAlert":
			case "showOk":
				this.alerts.push({ t: Date.now() - this.t0, context, event });
				break;
			case "setFeedback":
			case "setFeedbackLayout":
				this.feedback.set(`${context}:${event}`, payload);
				this.lastPaintAt = Date.now();
				break;
			case "sendToPropertyInspector":
				this.toPropertyInspector.push({ context, payload });
				break;
			default:
				break;
		}
		this.emit("message", msg);
		if (event) {
			this.emit(event, msg);
		}
	}
}

function deviceInfo(device) {
	const { name, size, type } = device;
	return { name, size, type };
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
