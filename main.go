// herdr-opendeck mirrors the current Herdr session onto Stream Deck keys via
// OpenDeck.
package main

import (
	"flag"
	"log"
	"os"
	"sync"
	"time"

	"github.com/ThomasRooney/herdr-opendeck/internal/deck"
	"github.com/ThomasRooney/herdr-opendeck/internal/herdr"
	"github.com/ThomasRooney/herdr-opendeck/internal/render"
)

const spaceAction = "com.thomasrooney.herdrdeck.space"

type state struct {
	mu        sync.Mutex
	instances map[string]bool            // context -> present
	assigned  map[string]herdr.Workspace // context -> workspace currently shown
	rendered  map[string]string          // context -> last image sent
}

func main() {
	port := flag.Int("port", 0, "websocket port provided by the host")
	pluginUUID := flag.String("pluginUUID", "", "plugin UUID provided by the host")
	registerEvent := flag.String("registerEvent", "registerPlugin", "registration event name")
	flag.String("info", "", "host info JSON (unused)")
	flag.Parse()
	if *port == 0 || *pluginUUID == "" {
		log.Fatal("must be launched by an OpenAction host (missing -port/-pluginUUID)")
	}

	client, err := deck.Connect(*port, *registerEvent, *pluginUUID)
	if err != nil {
		log.Fatalf("failed to connect to host: %v", err)
	}

	shared := &state{
		instances: map[string]bool{},
		assigned:  map[string]herdr.Workspace{},
		rendered:  map[string]string{},
	}
	bridge := herdr.NewBridge()

	setImage := func(context, image string) {
		if shared.rendered[context] == image {
			return
		}
		if err := client.SetImage(context, image); err == nil {
			shared.rendered[context] = image
		}
	}

	refresh := func() {
		shared.mu.Lock()
		defer shared.mu.Unlock()
		if len(shared.instances) == 0 {
			return
		}
		snapshot, err := bridge.Snapshot()
		var space *herdr.Workspace
		if err == nil {
			space = snapshot.FirstWorkspace()
		}
		for context := range shared.instances {
			switch {
			case err != nil:
				delete(shared.assigned, context)
				setImage(context, render.DisconnectedTile())
			case space == nil:
				delete(shared.assigned, context)
				setImage(context, render.EmptyTile())
			default:
				shared.assigned[context] = *space
				setImage(context, render.SpaceTile(*space, herdr.GitInfoFor(snapshot.WorkingDir(*space))))
			}
		}
	}

	go func() {
		for {
			refresh()
			time.Sleep(time.Second)
		}
	}()

	for {
		event, err := client.Read()
		if err != nil {
			os.Exit(0) // host closed the connection
		}
		switch event.Event {
		case "willAppear":
			if event.Action != spaceAction {
				continue
			}
			shared.mu.Lock()
			shared.instances[event.Context] = true
			delete(shared.rendered, event.Context)
			shared.mu.Unlock()
			refresh()
		case "willDisappear":
			shared.mu.Lock()
			delete(shared.instances, event.Context)
			delete(shared.assigned, event.Context)
			delete(shared.rendered, event.Context)
			shared.mu.Unlock()
		case "keyDown":
			shared.mu.Lock()
			space, ok := shared.assigned[event.Context]
			shared.mu.Unlock()
			if !ok {
				continue
			}
			go func(space herdr.Workspace, context string) {
				if err := bridge.FocusWorkspace(space.WorkspaceID); err != nil {
					_ = client.ShowAlert(context)
					_ = client.LogMessage("focus " + space.WorkspaceID + " failed: " + err.Error())
					return
				}
				if err := herdr.RaiseClient(); err != nil {
					_ = client.LogMessage("raise client failed: " + err.Error())
				}
			}(space, event.Context)
		}
	}
}
