import {
	action,
	type KeyAction,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { DeckController } from "./controller";

/** A live tile for one Herdr workspace; press focuses it. */
@action({ UUID: "com.thomasrooney.herdrdeck.space" })
export class SpaceAction extends SingletonAction {
	constructor(private readonly controller: DeckController) {
		super();
	}

	public override onKeyUp(ev: KeyUpEvent): void {
		this.controller.keyUp(ev.action.id);
	}

	public override onWillAppear(ev: WillAppearEvent): void {
		this.controller.add(ev.action.id, ev.action as KeyAction, false);
	}

	public override onWillDisappear(ev: WillDisappearEvent): void {
		this.controller.remove(ev.action.id);
	}
}

/** Creates a Herdr workspace and focuses it. */
@action({ UUID: "com.thomasrooney.herdrdeck.newspace" })
export class NewSpaceAction extends SingletonAction {
	constructor(private readonly controller: DeckController) {
		super();
	}

	public override onKeyUp(ev: KeyUpEvent): void {
		this.controller.keyUp(ev.action.id);
	}

	public override onWillAppear(ev: WillAppearEvent): void {
		this.controller.add(ev.action.id, ev.action as KeyAction, true);
	}

	public override onWillDisappear(ev: WillDisappearEvent): void {
		this.controller.remove(ev.action.id);
	}
}
