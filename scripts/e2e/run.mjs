/**
 * End-to-end run of the built plugin bundle against a fake Stream Deck
 * host and an isolated herdr server. No device, no Elgato app, no human.
 *
 *   npm run build && npm run e2e
 *
 * Env:
 *   HERDR_BIN   herdr binary (default: herdr on PATH)
 *   E2E_NODE    node binary for the plugin (default: the Elgato app's
 *               bundled Node if installed, else this node)
 *   E2E_OUT     artifact directory (default: e2e-out/)
 *   E2E_SKIP    comma list of phases to skip
 *   E2E_PLUGIN  .sdPlugin dir to test instead of ./plugin (copied, never modified)
 *   E2E_ACTIVITY=0  publish no herdr-agent-activity tokens: the deck as
 *               it looks without that plugin
 *
 * Artifacts: per-phase key SVG/PNGs, board PNGs, messages.jsonl (every
 * websocket frame both ways), summary.json. Each phase runs even if an
 * earlier one failed; the exit code is 1 on any failure.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FakeStreamDeck, sleep, STREAM_DECK_15 } from "./fake-streamdeck.mjs";
import { HerdrSandbox } from "./herdr-sandbox.mjs";
import { renderBoard, svgToPng } from "./render-board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PLUGIN_SRC = resolve(process.env.E2E_PLUGIN ?? join(REPO, "plugin"));
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN_SRC, "manifest.json"), "utf8"));
const UUID = (name) => `com.resilientsoftware.herdrdeck.${name}`;
const HERDR_BIN = process.env.HERDR_BIN ?? which("herdr");
const SKIP = new Set((process.env.E2E_SKIP ?? "").split(",").filter(Boolean));
const ACTIVITY = process.env.E2E_ACTIVITY !== "0";

const COLORS = {
	focused: "#a6e3a1",
	working: "#f9e2af",
	blocked: "#f38ba8",
	activity: "#89b4fa",
	scheduled: "#362a52",
	mauve: "#cba6f7",
};

function which(name) {
	try {
		return execFileSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim();
	} catch {
		throw new Error(`${name} not found on PATH; set HERDR_BIN`);
	}
}

function elgatoNode() {
	const base = join(homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "NodeJS");
	try {
		const major = `${MANIFEST.Nodejs?.Version ?? "24"}.`;
		const latest = readdirSync(base)
			.filter((v) => v.startsWith(major))
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
			.at(-1);
		const bin = latest && join(base, latest, "node");
		return bin && existsSync(bin) ? bin : undefined;
	} catch {
		return undefined;
	}
}

const hex = (text) => Buffer.from(text).toString("hex");

// A short root: herdr's unix socket path must stay under the macOS limit.
const root = mkdtempSync(join(tmpdir(), "hd-e2e-"));
const out = resolve(process.env.E2E_OUT ?? join(REPO, "e2e-out"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
	results.push({ name, ok: Boolean(ok), detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
async function phase(name, fn) {
	if (SKIP.has(name)) {
		console.log(`SKIP  ${name}`);
		return;
	}
	console.log(`----  ${name}`);
	try {
		await fn();
	} catch (err) {
		check(`phase ${name} completed`, false, String(err?.message ?? err));
	}
}

// ---- stage the bundle like an installed plugin -------------------------
const pluginDir = join(root, `${MANIFEST.UUID}.sdPlugin`);
cpSync(PLUGIN_SRC, pluginDir, {
	recursive: true,
	filter: (src) => !/\/logs(\/|$)/.test(src.slice(PLUGIN_SRC.length)),
});
if (!existsSync(join(pluginDir, MANIFEST.CodePath))) {
	throw new Error(`no ${MANIFEST.CodePath} in ${PLUGIN_SRC}; run npm run build first`);
}

// Belt and braces next to HERDR_DECK_NO_RAISE: an `open` that only records.
const stubs = join(root, "stubs");
mkdirSync(stubs, { recursive: true });
const openLog = join(out, "open.log");
writeFileSync(join(stubs, "open"), `#!/bin/sh\necho "open $*" >> "${openLog}"\n`);
chmodSync(join(stubs, "open"), 0o755);

// herdr detects agents by process name: compile the stand-in as "claude".
const agentBin = join(root, "agentbin");
mkdirSync(agentBin, { recursive: true });
execFileSync("cc", ["-O2", "-o", join(agentBin, "claude"), join(HERE, "fake-agent.c")]);

const sandbox = new HerdrSandbox({ root, binary: HERDR_BIN });
const repos = join(root, "repos");
function gitRepo(name, branch) {
	const dir = join(repos, name);
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "-q", "-b", branch, dir]);
	execFileSync("git", ["-C", dir, "-c", "user.name=e2e", "-c", "user.email=e2e@example.invalid", "commit", "-q", "--allow-empty", "-m", "init"]);
	return dir;
}

// The plugin gets a launchd-like minimal environment, not the caller's.
const sbxEnv = sandbox.env();
const host = new FakeStreamDeck({
	pluginDir,
	nodeBin: process.env.E2E_NODE ?? elgatoNode() ?? process.execPath,
	nodeArgs: ["--no-global-search-paths", "--enable-source-maps"],
	env: {
		HOME: homedir(),
		USER: process.env.USER ?? "",
		LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "",
		TMPDIR: process.env.TMPDIR ?? "/tmp",
		LANG: "en_US.UTF-8",
		PATH: `${stubs}:/usr/bin:/bin:/usr/sbin:/sbin`,
		HERDR_PATH: sbxEnv.HERDR_PATH,
		HERDR_SOCKET_PATH: sbxEnv.HERDR_SOCKET_PATH,
		HERDR_DECK_NO_RAISE: "1",
		XDG_CONFIG_HOME: sbxEnv.XDG_CONFIG_HOME,
	},
	devices: [STREAM_DECK_15],
});

/*
 * Layout on the 5x3 deck:
 *   row 0: space space space space  newspace
 *   row 1: space space space space  summary
 *   row 2: command text keys cycle  newtab
 */
const ctx = (column, row) => `key-${column}-${row}`;
const spaceKeys = [
	[0, 0],
	[1, 0],
	[2, 0],
	[3, 0],
	[0, 1],
	[1, 1],
	[2, 1],
	[3, 1],
];
const K = {
	newSpace: ctx(4, 0),
	summary: ctx(4, 1),
	command: ctx(0, 2),
	text: ctx(1, 2),
	keys: ctx(2, 2),
	cycle: ctx(3, 2),
	newTab: ctx(4, 2),
};
const svgOf = (context) => host.image(context)?.text ?? "";
const svgAt = (column, row) => svgOf(ctx(column, row));
const tileWith = (text) => [...host.placed.keys()].find((context) => svgOf(context).includes(text));
const tile = (label) => svgOf(tileWith(`>${label}<`));

const canRender = (() => {
	try {
		execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		console.log("rsvg-convert not found: board PNGs skipped");
		return false;
	}
})();

function board(name, title) {
	if (!canRender) {
		return undefined;
	}
	const dir = join(out, name);
	for (const file of host.dumpImages(dir).filter((f) => f.endsWith(".svg"))) {
		svgToPng(file, file.replace(/\.svg$/, ".png"));
	}
	const cells = [...host.placed.entries()]
		.filter(([, placed]) => placed.controller === "Keypad")
		.map(([context, placed]) => ({ ...placed.coordinates, svg: svgOf(context) }));
	return renderBoard({ columns: 5, rows: 3, cells, title, svgFile: join(out, `board-${name}.svg`), pngFile: join(out, `board-${name}.png`) });
}

/** Hex chunks the stand-in agent has printed so far. */
async function agentInput(paneId) {
	const text = (await sandbox.readPane(paneId, 200)).read.text;
	return [...text.matchAll(/a\.K\d+:([0-9a-f]+)/g)].map((m) => m[1]);
}

async function waitForAgentInput(paneId, predicate, what) {
	return host.waitFor(async () => {
		const chunks = await agentInput(paneId);
		return predicate(chunks) ? chunks : null;
	}, 4000, what);
}

let pinger;
const rtts = [];
const ws = {};
try {
	await phase("seed", async () => {
		await sandbox.start();
		const plainDir = join(root, "plain");
		mkdirSync(plainDir, { recursive: true });
		ws.api = await sandbox.createWorkspace({ label: "api", cwd: gitRepo("api-server", "feat/login") });
		ws.web = await sandbox.createWorkspace({ label: "web", cwd: gitRepo("web-app", "main") });
		ws.infra = await sandbox.createWorkspace({ label: "infra", cwd: gitRepo("infra", "fix/dns") });
		ws.docs = await sandbox.createWorkspace({ label: "docs", cwd: gitRepo("docs", "main") });
		ws.scratch = await sandbox.createWorkspace({ label: "scratch", cwd: plainDir });
		ws.agent = await sandbox.createWorkspace({ label: "agent", cwd: gitRepo("agent", "main") });
		ws.notes = await sandbox.createWorkspace({ label: "notes", cwd: gitRepo("notes", "main"), focus: true });
		await sandbox.request("pane.send_input", { pane_id: ws.agent.paneId, text: `exec ${join(agentBin, "claude")} a bp`, keys: ["enter"] });
		await sandbox.reportAgent(ws.api.paneId, "working");
		await sandbox.reportAgent(ws.web.paneId, "blocked");
		for (const name of ["infra", "docs", "scratch"]) {
			await sandbox.reportAgent(ws[name].paneId, "idle");
		}
		if (ACTIVITY) {
			await sandbox.reportActivity(ws.infra.workspaceId, { rsact_v: "1", rsact_state: "subagents", rsact_subagents: "2", rsact_background: "1" });
			await sandbox.reportActivity(ws.docs.workspaceId, {
				rsact_v: "1",
				rsact_state: "scheduled",
				rsact_loop: "1",
				rsact_next_at: new Date(Date.now() + 17 * 60_000).toISOString(),
			});
		}
		const detected = await host.waitFor(
			async () => (await sandbox.snapshot()).panes.find((p) => p.pane_id === ws.agent.paneId && p.agent === "claude"),
			6000,
			"stand-in agent detected",
		);
		check("sandbox seeded; stand-in agent detected", Boolean(detected), ws.agent.paneId);
	});

	await phase("connect", async () => {
		const registered = await host.start();
		check("plugin registers over websocket", registered.event === "registerPlugin");
		pinger = setInterval(() => host.ping().then((ms) => rtts.push(ms), () => rtts.push(Infinity)), 500);
		for (const [column, row] of spaceKeys) {
			host.willAppear({ context: ctx(column, row), action: UUID("space"), coordinates: { column, row } });
		}
		const control = (context, action, settings = {}) => {
			const [, column, row] = context.split("-").map(Number);
			host.willAppear({ context, action: UUID(action), coordinates: { column, row }, settings });
		};
		control(K.newSpace, "newspace");
		control(K.summary, "summary");
		control(K.command, "command", { command: "/review" });
		control(K.text, "text", { text: "go ahead", submit: true });
		control(K.keys, "keys");
		control(K.cycle, "cycle", { command: "/model", values: "opus, sonnet, haiku" });
		control(K.newTab, "newtab");
		await host.waitFor(() => svgAt(0, 0).includes("CONNECTING"), 3000, "CONNECTING tile");
		check("first paint is HERDR · CONNECTING on the top-left key", true);
		const tLive = Date.now();
		await host.waitFor(() => tileWith(">notes<"), 8000, "live tiles");
		check("live tiles arrive", true, `${Date.now() - tLive} ms after CONNECTING`);
		await host.waitForQuiet(1500);
		board("initial", "initial: 7 spaces, summary and control keys");
	});

	await phase("states", async () => {
		check("working tile is yellow with repo + branch", tile("api").includes(COLORS.working) && tile("api").includes("api-server") && tile("api").includes("feat/login"));
		check("blocked tile is red", tile("web").includes(COLORS.blocked));
		const infra = tile("infra");
		const docs = tile("docs");
		if (ACTIVITY) {
			check(
				"subagent activity tile is blue with icon counts, no SUB/BG words",
				infra.includes(COLORS.activity) && />2<\/text>/.test(infra) && />1<\/text>/.test(infra) && !/SUB|BG/.test(infra),
			);
			check("scheduled-check tile is mauve with a loop countdown", docs.includes(COLORS.scheduled) && docs.includes(COLORS.mauve) && /1[67]M/.test(docs), /\d+M/.exec(docs)?.[0]);
		} else {
			for (const [label, svg] of [["infra", infra], ["docs", docs]]) {
				check(`without activity, idle ${label} is a plain IDLE tile`, svg.includes(">IDLE<") && !svg.includes("<rect") && !svg.includes("<g transform"));
			}
		}
		const noTokens = ["api", "web", "scratch", "notes"].filter((label) => tile(label).includes("<g transform"));
		check("workspaces without activity tokens never show activity icons", noTokens.length === 0, noTokens.join(","));
		check("plain idle tile names its state", tile("scratch").includes(">IDLE<") && !tile("scratch").includes("<rect"));
		check("focused tile is green", tile("notes").includes(COLORS.focused));
		check("unused participating key is an inert dot", svgAt(3, 1).includes("<circle"));
		check("control keys never take a space slot", !svgOf(K.command).includes(">api<") && svgOf(K.command).includes("/review"));
		check("New Space key is live (not dimmed)", svgOf(K.newSpace).includes("NEW SPACE") && !svgOf(K.newSpace).includes("opacity"));
		check("no host alert overlays used", host.alerts.length === 0);
	});

	await phase("press", async () => {
		const apiKey = tileWith(">api<");
		const t0 = Date.now();
		await host.press(apiKey);
		const focusMs = await host.waitFor(async () => ((await sandbox.focusedWorkspaceId()) === ws.api.workspaceId ? Date.now() - t0 : 0), 4000, "herdr focus");
		check("keyUp on a space tile focuses that workspace in herdr", true, `${focusMs} ms keyUp -> herdr focused`);
		const greenMs = await host.waitFor(() => (svgOf(apiKey).includes(COLORS.focused) ? Date.now() - t0 : 0), 4000, "green tile");
		check("pressed tile turns green once herdr confirms", true, `${greenMs} ms keyUp -> green setImage`);
		const lostGreen = await host.waitFor(() => !tile("notes").includes(COLORS.focused), 2000, "notes loses green").then(() => true, () => false);
		check("previously focused tile loses green", lostGreen);
		check("HERDR_DECK_NO_RAISE keeps the terminal where it is", !existsSync(openLog));
		await host.waitForQuiet(800);
		board("after-press", "after keyUp on 'api'");
	});

	await phase("summary", async () => {
		const summary = svgOf(K.summary);
		// working api, blocked web, busy infra, timer docs (idle without activity), idle scratch + agent; notes runs no agent.
		check("summary counts the six workspaces running agents", summary.includes(">6</text>"), />(\d+)<\/text>/.exec(summary)?.[1]);
		check(
			ACTIVITY ? "summary ring includes the busy and timer states" : "summary ring has no busy or timer segments without activity",
			ACTIVITY === (summary.includes('stroke="#89b4fa"') && summary.includes('stroke="#cba6f7"')),
		);
		check("summary calls out the blocked agent", summary.includes("1 BLOCKED"));
		await host.press(K.summary);
		await host.waitFor(async () => (await sandbox.focusedWorkspaceId()) === ws.web.workspaceId, 4000, "focus blocked workspace");
		check("pressing the summary jumps to the blocked workspace", true);
	});

	await phase("steady", async () => {
		await host.waitForQuiet(1200);
		const before = new Map(host.imageCounts);
		await sleep(6000);
		const countdowns = new Set([tileWith(">docs<"), K.summary]);
		const churn = [...host.imageCounts.entries()].filter(([context, n]) => n !== (before.get(context) ?? 0) && !countdowns.has(context));
		check("no redundant setImage in 6 s of steady state", churn.length === 0, churn.map(([c]) => c).join(",") || "0 repaints");
	});

	await phase("command", async () => {
		await sandbox.request("workspace.focus", { workspace_id: ws.agent.workspaceId });
		await host.waitFor(() => svgOf(K.command).includes("&gt; agent"), 4000, "command key targets the agent");
		check("command key shows its target", true);
		const before = (await agentInput(ws.agent.paneId)).length;
		await host.press(K.command);
		const chunks = await waitForAgentInput(ws.agent.paneId, (c) => c.slice(before).some((h) => h.includes(hex("/review"))), "/review typed");
		check("Slash Command types /review into the focused agent", true, chunks.slice(before).join(" ").slice(0, 80));
		const enter = await waitForAgentInput(ws.agent.paneId, (c) => c.slice(before).includes("0d"), "Enter after the command").then(() => true, () => false);
		check("Slash Command presses Enter after the text", enter);
		await host.waitFor(() => svgOf(K.command).includes(">SENT<"), 2000, "SENT flash");
		check("command key flashes SENT", true);
	});

	await phase("blocked", async () => {
		await sandbox.reportAgent(ws.agent.paneId, "blocked");
		await host.waitFor(async () => (await sandbox.snapshot()).panes.find((p) => p.pane_id === ws.agent.paneId)?.agent_status === "blocked", 3000, "agent blocked");
		await sleep(500);
		const before = (await agentInput(ws.agent.paneId)).length;
		await host.press(K.text);
		await host.waitFor(() => svgOf(K.text).includes(">BLOCKED<"), 3000, "BLOCKED flash");
		await sleep(600);
		const after = await agentInput(ws.agent.paneId);
		check("nothing is typed into an agent waiting at a permission prompt", !after.slice(before).some((h) => h.includes(hex("go ahead"))), `${after.length - before} new chunks`);
		await host.press(K.keys);
		const esc = await waitForAgentInput(ws.agent.paneId, (c) => c.slice(before).includes("1b"), "esc").then(() => true, () => false);
		check("Send Keys still sends esc to the blocked agent", esc);
		await sandbox.reportAgent(ws.agent.paneId, "idle");
	});

	await phase("cycle", async () => {
		const before = (await agentInput(ws.agent.paneId)).length;
		for (let i = 0; i < 3; i++) {
			await host.press(K.cycle);
		}
		const values = ["/model opus", "/model sonnet", "/model haiku"].map(hex);
		const chunks = await waitForAgentInput(
			ws.agent.paneId,
			(c) => {
				const text = c.slice(before).join("|");
				return values.every((v) => text.includes(v));
			},
			"three cycle values",
		).catch(() => []);
		const text = chunks.slice(before).join("|");
		const order = values.map((v) => text.indexOf(v));
		check("Cycle sends opus, sonnet, haiku in order", order.every((p, i) => p >= 0 && (i === 0 || p > order[i - 1])), order.join(","));
		const indexes = host
			.messagesFromPlugin("setSettings")
			.filter((entry) => entry.msg.context === K.cycle)
			.map((entry) => entry.msg.payload.index);
		check("Cycle saves its index after each press", indexes.slice(-3).join(",") === "1,2,0", indexes.join(","));
		await host.waitFor(() => svgOf(K.cycle).includes(">opus<"), 3000, "cycle face back to opus");
		check("Cycle shows the value the next press sends", true);
	});

	await phase("newtab", async () => {
		const tabsBefore = (await sandbox.snapshot()).tabs.filter((t) => t.workspace_id === ws.agent.workspaceId).length;
		await host.press(K.newTab);
		const snap = await host.waitFor(async () => {
			const s = await sandbox.snapshot();
			return s.tabs.filter((t) => t.workspace_id === ws.agent.workspaceId).length === tabsBefore + 1 ? s : null;
		}, 4000, "new tab");
		const agentCwd = snap.panes.find((p) => p.pane_id === ws.agent.paneId)?.cwd;
		const focusedPane = snap.panes.find((p) => p.pane_id === snap.focused_pane_id);
		check("New Tab opens a tab in the agent workspace, focused", focusedPane?.workspace_id === ws.agent.workspaceId && focusedPane.pane_id !== ws.agent.paneId);
		check("New Tab opens in the target pane's folder", focusedPane?.cwd === agentCwd, `${focusedPane?.cwd} vs ${agentCwd}`);
	});

	await phase("pinned", async () => {
		host.inspectorSetSettings(K.text, { text: "pinned hello", submit: true, target: ws.agent.workspaceId, targetLabel: "agent" });
		await sandbox.request("workspace.focus", { workspace_id: ws.notes.workspaceId });
		await host.waitFor(() => /#\d+ agent</.test(svgOf(K.text)), 4000, "pinned footer");
		const before = (await agentInput(ws.agent.paneId)).length;
		const notesBefore = (await sandbox.readPane(ws.notes.paneId, 200)).read.text;
		await host.press(K.text);
		const got = await waitForAgentInput(ws.agent.paneId, (c) => c.slice(before).some((h) => h.includes(hex("pinned hello"))), "pinned text").then(() => true, () => false);
		check("a key pinned to a workspace sends there while another is focused", got);
		const notesAfter = (await sandbox.readPane(ws.notes.paneId, 200)).read.text;
		check("the focused workspace receives nothing", !notesAfter.includes("pinned hello") && notesAfter.length >= notesBefore.length - 1);
	});

	await phase("pi", async () => {
		host.propertyInspectorDidAppear(K.command);
		await sleep(200);
		host.sendToPlugin(K.command, { event: "getWorkspaces" });
		const reply = await host.waitFor(() => host.toPropertyInspector.find((m) => m.payload?.event === "getWorkspaces"), 3000, "workspace list");
		const pinned = reply.payload.items.find((item) => item.children)?.children ?? [];
		check(
			"property inspector gets Focused agent plus every workspace by name",
			reply.payload.items[0]?.value === "" && pinned.some((c) => c.label === "agent" && c.value === ws.agent.workspaceId),
			pinned.map((c) => c.label).join(", "),
		);
	});

	await phase("newspace", async () => {
		const countBefore = (await sandbox.snapshot()).workspaces.length;
		await host.press(K.newSpace);
		await host.waitFor(async () => (await sandbox.snapshot()).workspaces.length === countBefore + 1, 4000, "workspace created");
		const created = (await sandbox.snapshot()).workspaces.find((space) => space.focused);
		check("New Space creates and focuses a workspace", created && created.number === countBefore + 1, created?.workspace_id);
		await host.waitFor(() => svgAt(3, 1).includes(COLORS.focused), 4000, "new tile");
		check("new workspace fills the first free key, green", true);
		await host.waitForQuiet(800);
		board("after-new-space", "after New Space");
	});

	await phase("pager", async () => {
		for (const [column, row] of spaceKeys.filter(([, r]) => r === 1)) {
			host.willDisappear(ctx(column, row));
		}
		await host.waitFor(() => svgAt(2, 0).includes("←") && svgAt(3, 0).includes("→"), 3000, "pager keys");
		check("pager appears on the last two space keys", svgAt(3, 0).includes("1/4"), /\d\/\d/.exec(svgAt(3, 0))?.[0]);
		check("→ is accented toward the off-page focused space", svgAt(3, 0).includes(`fill="${COLORS.focused}"`) && !svgAt(2, 0).includes(`fill="${COLORS.focused}"`));
		await host.press(ctx(3, 0));
		await host.waitFor(() => svgAt(3, 0).includes("2/4"), 2000, "page 2/4");
		check("→ pages forward one page", svgAt(0, 0).includes(">infra<") && svgAt(1, 0).includes(">docs<"));
		await host.press(ctx(2, 0));
		await host.press(ctx(2, 0));
		await host.waitFor(() => svgAt(2, 0).includes("1/4"), 2000, "page 1/4");
		check("← does not wrap past the first page", svgAt(0, 0).includes(">api<"));
		await host.waitForQuiet(600);
		board("pager", "4 space keys, 8 spaces: pager");
		for (const [column, row] of spaceKeys.filter(([, r]) => r === 1)) {
			host.willAppear({ context: ctx(column, row), action: UUID("space"), coordinates: { column, row } });
		}
		await host.waitFor(() => !svgAt(3, 0).includes("→"), 3000, "pager gone");
		check("pager disappears when keys return", true);
	});

	await phase("offline", async () => {
		const tStop = Date.now();
		await sandbox.stop();
		await host.waitFor(() => svgAt(0, 0).includes("OFFLINE"), 10000, "OFFLINE tile");
		check("server loss -> HERDR OFFLINE on top-left", true, `${Date.now() - tStop} ms after server.stop`);
		check("New Space dims while offline", svgOf(K.newSpace).includes("opacity"));
		check("summary shows OFFLINE, not stale counts", svgOf(K.summary).includes("OFFLINE") && !/>\d+<\/text>/.test(svgOf(K.summary)));
		check("control keys dim while offline", svgOf(K.command).includes('opacity="0.45"') && svgOf(K.command).includes("OFFLINE"));
		await host.waitForQuiet(600);
		board("offline", "herdr server stopped");
		const tStart = Date.now();
		await sandbox.start();
		await host.waitFor(() => !svgAt(0, 0).includes("OFFLINE") && !svgAt(0, 0).includes("CONNECTING"), 20000, "recovery");
		check("recovers automatically when the server returns", true, `${Date.now() - tStart} ms after restart`);
		await host.waitForQuiet(1000);
		board("recovered", "herdr server restarted");
	});

	const finite = rtts.filter(Number.isFinite).sort((a, b) => a - b);
	check(
		"websocket ping answered throughout (Elgato watchdog proxy)",
		finite.length === rtts.length && finite.length > 0,
		`${finite.length} pings, max ${finite.at(-1)?.toFixed(1)} ms, p50 ${finite[Math.floor(finite.length / 2)]?.toFixed(1)} ms`,
	);
} finally {
	clearInterval(pinger);
	await host.stop();
	await sandbox.stop();
	writeFileSync(join(out, "messages.jsonl"), host.log.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
	writeFileSync(join(out, "plugin-stderr.txt"), host.stderr);
	const logs = join(pluginDir, "logs");
	if (existsSync(logs)) {
		cpSync(logs, join(out, "plugin-logs"), { recursive: true });
	}
	const summary = {
		plugin: PLUGIN_SRC,
		node: host.opts.nodeBin,
		passed: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).length,
		results,
		setImageCounts: Object.fromEntries(host.imageCounts),
	};
	writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
	rmSync(root, { recursive: true, force: true });
	console.log(`\n${summary.passed} passed, ${summary.failed} failed — artifacts in ${out}`);
	process.exitCode = summary.failed ? 1 : 0;
}
