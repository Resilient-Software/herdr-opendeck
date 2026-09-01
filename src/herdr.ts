/**
 * Talks to the herdr CLI to observe and control the current Herdr session.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, basename as pathBasename } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { defaultSocketPath, SocketClient, type SubscriptionEvent } from "./socket";

const execFileAsync = promisify(execFile);

const RUN_TIMEOUT_MS = 2500;

export type AgentStatus = "blocked" | "done" | "idle" | "unknown" | "working";

export type Pane = {
	pane_id: string;
	agent: string;
	agent_status: AgentStatus;
	focused: boolean;
	label: string;
	terminal_title_stripped: string;
	cwd: string;
	workspace_id: string;
};

export type Worktree = {
	checkout_path: string;
	repo_name: string;
};

export type Workspace = {
	workspace_id: string;
	number: number;
	label: string;
	agent_status: AgentStatus;
	pane_count: number;
	tab_count: number;
	focused: boolean;
	worktree: Worktree | null;
};

export type Snapshot = {
	focused_pane_id: string;
	panes: Pane[];
	workspaces: Workspace[];
};

export type GitInfo = {
	/** Repository directory name, or the cwd's basename outside git. */
	repo: string;
	/** Current branch, or short commit hash when detached; empty outside git. */
	branch: string;
};

/**
 * Locations the official installers use: the herdr.dev install script
 * defaults to ~/.local/bin, with Homebrew and Nix as the documented
 * alternatives.
 */
function commonBinaryPaths(): string[] {
	const home = homedir();
	return [
		join(home, ".local", "bin", "herdr"),
		"/opt/homebrew/bin/herdr",
		"/usr/local/bin/herdr",
		join(home, ".nix-profile", "bin", "herdr"),
		"/run/current-system/sw/bin/herdr",
	];
}

/**
 * Finds a running herdr client via ps and returns its absolute binary
 * path, for installs in unconventional locations.
 */
async function binaryFromProcessList(): Promise<string> {
	try {
		const { stdout } = await execFileAsync("ps", ["-axo", "command="]);
		for (const line of stdout.split("\n")) {
			const command = line.trim().split(/\s+/)[0] ?? "";
			if (command.startsWith("/") && pathBasename(command) === "herdr" && existsSync(command)) {
				return command;
			}
		}
	} catch {
		// ps unavailable; fall through.
	}
	return "";
}

/**
 * Resolution order: HERDR_PATH, the path the installer recorded next to the
 * bundle, the official install locations, a running herdr process, then
 * bare "herdr" and hope PATH has it. The host application may run with a
 * minimal PATH, which is why the earlier steps exist.
 */
export async function resolveBinary(): Promise<string> {
	const fromEnv = process.env.HERDR_PATH;
	if (fromEnv) {
		return fromEnv;
	}
	try {
		const bundleRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
		const recorded = readFileSync(join(bundleRoot, "herdr-path.txt"), "utf8").trim();
		if (recorded && existsSync(recorded)) {
			return recorded;
		}
	} catch {
		// No recorded path; keep looking.
	}
	for (const candidate of commonBinaryPaths()) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	const fromProcess = await binaryFromProcessList();
	if (fromProcess) {
		return fromProcess;
	}
	return "herdr";
}

/**
 * Session changes that can alter what the deck shows: the workspace set,
 * names, focus, and every pane change (pane.updated carries agent status
 * flips). The event payloads are not applied directly — any of these just
 * triggers a snapshot refresh, keeping the snapshot authoritative.
 */
const CHANGE_SUBSCRIPTIONS = [
	"workspace.created",
	"workspace.updated",
	"workspace.renamed",
	"workspace.moved",
	"workspace.reordered",
	"workspace.closed",
	"workspace.focused",
	"pane.created",
	"pane.closed",
	"pane.updated",
	"pane.exited",
	"pane.agent_detected",
].map((type) => ({ type }));

/**
 * Reads the subscription types a server offers out of its unknown-variant
 * rejection ("unknown variant `x`, expected one of `a`, `b`, ...") and
 * intersects them with the ones the deck wants.
 */
function supportedSubset(message: string): { type: string }[] {
	const listed = /expected one of (.+)/.exec(message);
	if (!listed) {
		return [];
	}
	const offered = new Set([...listed[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]));
	return CHANGE_SUBSCRIPTIONS.filter((subscription) => offered.has(subscription.type));
}

function isPaneChurn(event: SubscriptionEvent, seen: Map<string, string>): boolean {
	if (event.event !== "pane_updated") {
		return false;
	}
	const pane = (event.data as { pane?: Pane } | undefined)?.pane;
	if (!pane) {
		return false;
	}
	const signature = JSON.stringify([pane.agent_status, pane.cwd, pane.focused, pane.workspace_id]);
	if (seen.get(pane.pane_id) === signature) {
		return true;
	}
	seen.set(pane.pane_id, signature);
	return false;
}

export class Bridge {
	/** Successful calls served per transport; compat-check asserts on it. */
	public readonly transport = { socket: 0, cli: 0 };
	private binary = "";
	private failuresSinceResolve = 0;
	private readonly socket: SocketClient;

	constructor(opts?: { socketPath?: string; timeoutMs?: number }) {
		this.socket = new SocketClient(opts?.socketPath ?? defaultSocketPath(), { timeoutMs: opts?.timeoutMs });
	}

	public async createWorkspace(): Promise<void> {
		try {
			await this.socket.request("workspace.create", { focus: true });
			this.transport.socket++;
		} catch {
			await this.run("workspace", "create", "--focus");
			this.transport.cli++;
		}
	}

	public async focusWorkspace(workspaceId: string): Promise<void> {
		try {
			await this.socket.request("workspace.focus", { workspace_id: workspaceId });
			this.transport.socket++;
		} catch {
			await this.run("workspace", "focus", workspaceId);
			this.transport.cli++;
		}
	}

	public async snapshot(): Promise<Snapshot> {
		try {
			const result = (await this.socket.request("session.snapshot", {})) as { snapshot?: Snapshot };
			if (result?.snapshot) {
				this.transport.socket++;
				return result.snapshot;
			}
		} catch {
			// Socket unavailable (old herdr, moved socket): use the CLI.
		}
		let out: string;
		try {
			out = await this.run("api", "snapshot");
			this.failuresSinceResolve = 0;
		} catch (err) {
			// The binary may have been (re)installed since the last resolve;
			// occasionally look again rather than staying offline forever.
			this.failuresSinceResolve++;
			if (this.failuresSinceResolve % 10 === 0) {
				this.binary = "";
			}
			throw err;
		}
		const envelope = JSON.parse(out) as {
			result?: Partial<Snapshot> & { snapshot?: Snapshot };
		};
		if (envelope.result?.snapshot) {
			this.transport.cli++;
			return envelope.result.snapshot;
		}
		// Some builds place the snapshot fields directly under result.
		if (envelope.result?.panes) {
			this.transport.cli++;
			return {
				focused_pane_id: envelope.result.focused_pane_id ?? "",
				panes: envelope.result.panes,
				workspaces: envelope.result.workspaces ?? [],
			};
		}
		throw new Error("no snapshot in herdr api response");
	}

	/**
	 * Streams change notifications from the server. Resolves once subscribed;
	 * rejects when the socket API is unavailable, in which case the caller
	 * stays on polling alone. pane_updated fires on every output revision
	 * while an agent streams, so those are dropped unless a field the deck
	 * actually renders from panes has changed.
	 *
	 * Servers reject the whole subscription when any type is unknown to them
	 * (herdr 0.7.5 lacks workspace.reordered), naming the variants they do
	 * accept; one retry with that intersection keeps the event stream on
	 * both older and newer servers. Anything the subset misses is covered by
	 * the reconciliation poll.
	 */
	public async subscribeChanges(onChange: () => void, onClose: () => void): Promise<void> {
		const seen = new Map<string, string>();
		const handler = (event: SubscriptionEvent) => {
			if (!isPaneChurn(event, seen)) {
				onChange();
			}
		};
		try {
			return await this.socket.subscribe(CHANGE_SUBSCRIPTIONS, handler, onClose);
		} catch (err) {
			const subset = supportedSubset(err instanceof Error ? err.message : String(err));
			if (subset.length === 0 || subset.length === CHANGE_SUBSCRIPTIONS.length) {
				throw err;
			}
			return await this.socket.subscribe(subset, handler, onClose);
		}
	}

	private async run(...args: string[]): Promise<string> {
		if (!this.binary) {
			this.binary = await resolveBinary();
		}
		const { stdout } = await execFileAsync(this.binary, args, { timeout: RUN_TIMEOUT_MS });
		return stdout;
	}
}

/** Prefer label, then terminal title, then the cwd basename, then the ID. */
export function paneDisplayLabel(pane: Pane): string {
	if (pane.label) {
		return pane.label;
	}
	if (pane.terminal_title_stripped) {
		return pane.terminal_title_stripped;
	}
	if (pane.cwd) {
		return basename(pane.cwd);
	}
	return pane.pane_id;
}

export function workingDir(snapshot: Snapshot, space: Workspace): string {
	if (space.worktree?.checkout_path) {
		return space.worktree.checkout_path;
	}
	for (const pane of snapshot.panes) {
		if (pane.workspace_id === space.workspace_id && pane.cwd) {
			return pane.cwd;
		}
	}
	return "";
}

const GIT_CACHE_TTL_MS = 5000;
const gitCache = new Map<string, { info: GitInfo; fetchedAt: number; refreshing: boolean }>();

/**
 * Returns the cached repository/branch for a directory, refreshing in the
 * background. The first call for a directory answers with the cwd basename
 * while git runs; onRefresh fires when a refresh lands so the caller can
 * repaint.
 */
export function gitInfoFor(cwd: string, onRefresh: () => void): GitInfo {
	if (!cwd) {
		return { repo: "", branch: "" };
	}
	const cached = gitCache.get(cwd);
	if (cached && (Date.now() - cached.fetchedAt < GIT_CACHE_TTL_MS || cached.refreshing)) {
		return cached.info;
	}
	const placeholder: GitInfo = cached?.info ?? { repo: basename(cwd), branch: "" };
	gitCache.set(cwd, { info: placeholder, fetchedAt: cached?.fetchedAt ?? 0, refreshing: true });
	void refreshGitInfo(cwd).then((info) => {
		const previous = gitCache.get(cwd)?.info;
		gitCache.set(cwd, { info, fetchedAt: Date.now(), refreshing: false });
		if (!previous || previous.repo !== info.repo || previous.branch !== info.branch) {
			onRefresh();
		}
	});
	return placeholder;
}

async function refreshGitInfo(cwd: string): Promise<GitInfo> {
	const top = await gitOutput(cwd, "rev-parse", "--show-toplevel");
	if (!top) {
		return { repo: basename(cwd), branch: "" };
	}
	let branch = await gitOutput(cwd, "rev-parse", "--abbrev-ref", "HEAD");
	if (branch === "HEAD") {
		branch = await gitOutput(cwd, "rev-parse", "--short", "HEAD");
	}
	return { repo: basename(top), branch };
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { timeout: RUN_TIMEOUT_MS });
		return stdout.trim();
	} catch {
		return "";
	}
}

function basename(path: string): string {
	return pathBasename(path.replace(/[/\\]+$/, ""));
}

/**
 * Raises the application hosting the herdr TUI client by walking the
 * client process's ancestry to the containing .app bundle.
 */
export async function raiseClient(): Promise<void> {
	if (process.platform !== "darwin") {
		return;
	}
	const app = await hostingApp();
	if (app) {
		await execFileAsync("open", ["-a", app]);
	}
}

async function hostingApp(): Promise<string> {
	let stdout: string;
	try {
		({ stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="]));
	} catch {
		return "";
	}
	const procs = new Map<number, { ppid: number; command: string }>();
	const clients: number[] = [];
	for (const line of stdout.split("\n")) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 3) {
			continue;
		}
		const pid = Number(fields[0]);
		const ppid = Number(fields[1]);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
			continue;
		}
		procs.set(pid, { ppid, command: fields.slice(2).join(" ") });
		// The TUI client is a bare `herdr` (or `herdr --session ...` /
		// `herdr session attach ...`) with no other subcommand.
		if (pathBasename(fields[2] ?? "") !== "herdr") {
			continue;
		}
		const rest = fields.slice(3);
		if (
			rest.length === 0 ||
			rest[0] === "--session" ||
			(rest.length > 1 && rest[0] === "session" && rest[1] === "attach")
		) {
			clients.push(pid);
		}
	}
	for (let pid of clients) {
		for (let depth = 0; depth < 20 && pid > 1; depth++) {
			const parent = procs.get(pid);
			if (!parent) {
				break;
			}
			const idx = parent.command.indexOf(".app/Contents/MacOS/");
			if (idx >= 0) {
				return parent.command.slice(0, idx + 4);
			}
			pid = parent.ppid;
		}
	}
	return "";
}
