/**
 * Compatibility probe: drives the plugin's own Bridge against a live herdr
 * session and asserts the API surface the plugin depends on. Exits nonzero
 * with a named violation on any mismatch. Run via scripts/compat-check.sh,
 * which boots an isolated session first.
 */
import { Bridge, type Snapshot, workingDir } from "../src/herdr";
import { defaultSocketPath, SocketClient } from "../src/socket";

function fail(violation: string): never {
	console.error(`COMPAT FAIL: ${violation}`);
	process.exit(1);
}

function assertField(object: Record<string, unknown>, field: string, type: string, where: string): void {
	if (typeof object[field] !== type) {
		fail(`${where}.${field} is ${typeof object[field]}, expected ${type}`);
	}
}

function assertSnapshotShape(snapshot: Snapshot): void {
	if (!Array.isArray(snapshot.workspaces)) {
		fail("snapshot.workspaces is not an array");
	}
	if (!Array.isArray(snapshot.panes)) {
		fail("snapshot.panes is not an array");
	}
	for (const space of snapshot.workspaces) {
		assertField(space, "workspace_id", "string", "workspace");
		assertField(space, "number", "number", "workspace");
		assertField(space, "agent_status", "string", "workspace");
		assertField(space, "focused", "boolean", "workspace");
	}
	for (const pane of snapshot.panes) {
		assertField(pane, "pane_id", "string", "pane");
		assertField(pane, "workspace_id", "string", "pane");
	}
}

const bridge = new Bridge();

// Whether this server speaks the socket API at all decides what "COMPAT OK"
// must mean: with a live socket, the CLI silently covering for it would hide
// a socket regression, so CLI use becomes a failure.
const socketAlive = await new SocketClient(defaultSocketPath())
	.request("ping", {})
	.then(() => true)
	.catch(() => false);

let changeEvents = 0;
const subscribed = await bridge
	.subscribeChanges(
		() => changeEvents++,
		() => {},
	)
	.then(() => true)
	.catch((err: unknown) => {
		if (socketAlive) {
			fail(`events.subscribe refused by a socket-capable server: ${err}`);
		}
		return false;
	});

const before = await bridge.snapshot().catch((err: unknown) => fail(`api snapshot: ${err}`));
assertSnapshotShape(before);

await bridge.createWorkspace().catch((err: unknown) => fail(`workspace create --focus: ${err}`));
const created = await bridge.snapshot().catch((err: unknown) => fail(`api snapshot after create: ${err}`));
assertSnapshotShape(created);
if (created.workspaces.length <= before.workspaces.length) {
	fail(`workspace create did not add a workspace (${before.workspaces.length} -> ${created.workspaces.length})`);
}
if (!created.workspaces.some((space) => space.focused)) {
	fail("no focused workspace after workspace create --focus");
}

const target = created.workspaces[0];
await bridge.focusWorkspace(target.workspace_id).catch((err: unknown) => fail(`workspace focus: ${err}`));
const focused = await bridge.snapshot().catch((err: unknown) => fail(`api snapshot after focus: ${err}`));
const now = focused.workspaces.find((space) => space.workspace_id === target.workspace_id);
if (!now?.focused) {
	fail(`workspace focus ${target.workspace_id} not reflected in the next snapshot`);
}

for (const space of focused.workspaces) {
	if (typeof workingDir(focused, space) !== "string") {
		fail(`workingDir returned a non-string for ${space.workspace_id}`);
	}
}

if (subscribed) {
	const deadline = Date.now() + 5000;
	while (changeEvents === 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (changeEvents === 0) {
		fail("no change events arrived after workspace create/focus");
	}
}
if (socketAlive && bridge.transport.cli > 0) {
	fail(`CLI served ${bridge.transport.cli} call(s) despite a live socket — socket transport regression`);
}

console.log(
	`COMPAT OK: ${focused.workspaces.length} workspaces, ${focused.panes.length} panes, ` +
		`statuses [${[...new Set(focused.workspaces.map((space) => space.agent_status))].join(", ")}], ` +
		`transport socket=${bridge.transport.socket} cli=${bridge.transport.cli}, ` +
		`events=${subscribed ? changeEvents : "unsupported"}`,
);
process.exit(0);
