import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import type { DeckController, KeyKind } from "./controller";

/**
 * Every action is a thin adapter: the controller owns state and drawing.
 * Each instance's settings travel with it, and property inspectors ask for
 * the current workspaces to pin a key to.
 */
abstract class DeckAction extends SingletonAction<JsonObject> {
	protected abstract readonly kind: KeyKind;

	constructor(protected readonly controller: DeckController) {
		super();
	}

	public override onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): void {
		this.controller.updateSettings(ev.action.id, ev.payload.settings);
	}

	public override onKeyDown(ev: KeyDownEvent<JsonObject>): void {
		this.controller.keyDown(ev.action.id);
	}

	public override onKeyUp(ev: KeyUpEvent<JsonObject>): void {
		this.controller.keyUp(ev.action.id);
	}

	public override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
		const payload = ev.payload;
		if (typeof payload !== "object" || payload === null || Array.isArray(payload) || payload.event !== "getWorkspaces") {
			return;
		}
		await streamDeck.ui.sendToPropertyInspector({
			event: "getWorkspaces",
			items: [
				{ label: "Focused agent", value: "" },
				{ label: "Pinned workspace", children: this.controller.workspaceItems() },
			],
		});
	}

	public override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
		if (ev.action.isKey()) {
			this.controller.add(ev.action.id, ev.action, this.kind, ev.payload.settings);
		}
	}

	public override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
		this.controller.remove(ev.action.id);
	}
}

/** A live tile for one Herdr workspace; press focuses it. */
@action({ UUID: "com.resilientsoftware.herdrdeck.space" })
export class SpaceAction extends DeckAction {
	protected readonly kind = "space";
}

/** Creates a Herdr workspace and focuses it. */
@action({ UUID: "com.resilientsoftware.herdrdeck.newspace" })
export class NewSpaceAction extends DeckAction {
	protected readonly kind = "newSpace";
}

/** Counts workspaces by state; press jumps to the one that needs you most. */
@action({ UUID: "com.resilientsoftware.herdrdeck.summary" })
export class SummaryAction extends DeckAction {
	protected readonly kind = "summary";
}

@action({ UUID: "com.resilientsoftware.herdrdeck.command" })
export class CommandAction extends DeckAction {
	protected readonly kind = "command";
}

@action({ UUID: "com.resilientsoftware.herdrdeck.text" })
export class TextAction extends DeckAction {
	protected readonly kind = "text";
}

@action({ UUID: "com.resilientsoftware.herdrdeck.keys" })
export class KeysAction extends DeckAction {
	protected readonly kind = "keys";
}

@action({ UUID: "com.resilientsoftware.herdrdeck.cycle" })
export class CycleAction extends DeckAction {
	protected readonly kind = "cycle";
}

@action({ UUID: "com.resilientsoftware.herdrdeck.newtab" })
export class NewTabAction extends DeckAction {
	protected readonly kind = "newtab";
}
