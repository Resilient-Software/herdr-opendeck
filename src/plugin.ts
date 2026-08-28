import streamDeck from "@elgato/streamdeck";

import { NewSpaceAction, SpaceAction } from "./actions";
import { DeckController } from "./controller";

const controller = new DeckController();
streamDeck.actions.registerAction(new SpaceAction(controller));
streamDeck.actions.registerAction(new NewSpaceAction(controller));

await streamDeck.connect();
