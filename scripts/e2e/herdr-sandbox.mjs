/**
 * An isolated herdr server for end-to-end tests: its own socket, config,
 * data and state, so it never touches a real herdr session.
 *
 * Layout under `root`:
 *   sb/     XDG dirs, herdr.sock, server log
 *   cwd/    working directory for the server and CLI calls
 * The socket is addressed by the RELATIVE path ../sb/herdr.sock from any
 * sibling directory of sb/ (cwd/ and the staged <uuid>.sdPlugin/). macOS
 * caps unix socket paths at 104 bytes, which long temp/scratch roots blow
 * through; relative addressing sidesteps it.
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export const SOCKET_RELATIVE = "../sb/herdr.sock";

/** Environment variables that would tie a process to the caller's real herdr pane or terminal. */
const LEAKY = [
	"HERDR_ENV",
	"HERDR_PANE_ID",
	"HERDR_TAB_ID",
	"HERDR_WORKSPACE_ID",
	"HERDR_BIN_PATH",
	"HERDR_SOCKET_PATH",
	"SSH_AUTH_SOCK",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TERMINFO",
	"GHOSTTY_RESOURCES_DIR",
	"GHOSTTY_BIN_DIR",
	"GHOSTTY_SHELL_FEATURES",
	"GHOSTTY_SURFACE_ID",
	"KITTY_WINDOW_ID",
	"WEZTERM_EXECUTABLE",
	"ITERM_SESSION_ID",
];

export class HerdrSandbox {
	constructor({ root, binary }) {
		this.root = root;
		this.binary = binary;
		this.sb = join(root, "sb");
		this.cwd = join(root, "cwd");
		for (const dir of ["config", "data", "state", "cache"]) {
			mkdirSync(join(this.sb, dir), { recursive: true });
		}
		mkdirSync(this.cwd, { recursive: true });
	}

	/** Env for anything that should talk to this sandbox (server, CLI, plugin). */
	env(extra = {}) {
		const env = { ...process.env };
		for (const key of LEAKY) {
			delete env[key];
		}
		return {
			...env,
			HERDR_SOCKET_PATH: SOCKET_RELATIVE,
			HERDR_PATH: this.binary,
			XDG_CONFIG_HOME: join(this.sb, "config"),
			XDG_DATA_HOME: join(this.sb, "data"),
			XDG_STATE_HOME: join(this.sb, "state"),
			XDG_CACHE_HOME: join(this.sb, "cache"),
			// Panes run a plain sh, not the user's login shell and its rc files.
			SHELL: "/bin/sh",
			TERM: "xterm-256color",
			...extra,
		};
	}

	async start(timeoutMs = 15000) {
		const log = openSync(join(this.sb, "server.out"), "a");
		this.server = spawn(this.binary, ["server"], {
			cwd: this.cwd,
			env: this.env(),
			detached: true,
			stdio: ["ignore", log, log],
		});
		this.server.unref();
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await this.request("ping", {}).then(() => true, () => false)) {
				return this.server.pid;
			}
			await sleep(200);
		}
		throw new Error("sandbox herdr server did not come up");
	}

	/** Stops the server via the API, then makes sure the process is gone. */
	async stop() {
		await this.request("server.stop", {}).catch(() => {});
		const pid = this.server?.pid;
		if (!pid) {
			return;
		}
		for (let i = 0; i < 30 && alive(pid); i++) {
			await sleep(100);
		}
		if (alive(pid)) {
			process.kill(pid, "SIGTERM");
		}
	}

	/**
	 * One newline-JSON request per connection, like src/socket.ts. The
	 * relative socket path is resolved against the sandbox cwd.
	 */
	request(method, params = {}, timeoutMs = 3000) {
		return new Promise((resolve, reject) => {
			const socket = net.connect(join(this.cwd, SOCKET_RELATIVE).length < 100 ? join(this.cwd, SOCKET_RELATIVE) : relativeSocket(this.cwd));
			let buf = "";
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error(`timeout: ${method}`));
			}, timeoutMs);
			socket.on("error", (err) => {
				clearTimeout(timer);
				reject(err);
			});
			socket.on("data", (chunk) => {
				buf += chunk;
				const nl = buf.indexOf("\n");
				if (nl < 0) {
					return;
				}
				clearTimeout(timer);
				socket.destroy();
				const envelope = JSON.parse(buf.slice(0, nl));
				if (envelope.error) {
					reject(new Error(`${method}: ${envelope.error.message ?? envelope.error.code}`));
				} else {
					resolve(envelope.result);
				}
			});
			socket.write(JSON.stringify({ id: `e2e-${method}`, method, params }) + "\n");
		});
	}

	async snapshot() {
		return (await this.request("session.snapshot")).snapshot;
	}

	async focusedWorkspaceId() {
		return (await this.snapshot()).workspaces.find((space) => space.focused)?.workspace_id ?? "";
	}

	/** Creates a workspace; returns { workspaceId, paneId }. */
	async createWorkspace({ label, cwd, focus = false }) {
		const result = await this.request("workspace.create", { label, cwd, focus });
		return { workspaceId: result.workspace.workspace_id, paneId: result.root_pane.pane_id };
	}

	/** Claims the pane for a fake agent in the given state (idle | working | blocked | unknown). */
	reportAgent(paneId, state, agent = "claude") {
		return this.request("pane.report_agent", { pane_id: paneId, source: "e2e", agent, state });
	}

	/** Publishes herdr-agent-activity style rsact_* tokens on a workspace. */
	reportActivity(workspaceId, tokens) {
		return this.request("workspace.report_metadata", { workspace_id: workspaceId, source: "e2e", tokens });
	}

	readPane(paneId, lines = 20) {
		return this.request("pane.read", { pane_id: paneId, source: "recent_unwrapped", lines });
	}
}

/**
 * Node's net.connect resolves relative paths against process.cwd(); keep
 * the harness itself in the sandbox cwd so the short relative path works.
 */
function relativeSocket(cwd) {
	if (process.cwd() !== cwd) {
		process.chdir(cwd);
	}
	return SOCKET_RELATIVE;
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
