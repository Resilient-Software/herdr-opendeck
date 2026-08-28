// herdr-opendeck mirrors the current Herdr session onto Stream Deck keys via
// OpenDeck.
package main

import (
	"flag"
	"log"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/ThomasRooney/herdr-opendeck/internal/deck"
	"github.com/ThomasRooney/herdr-opendeck/internal/herdr"
	"github.com/ThomasRooney/herdr-opendeck/internal/layout"
	"github.com/ThomasRooney/herdr-opendeck/internal/render"
)

const (
	spaceAction    = "com.thomasrooney.herdrdeck.space"
	newSpaceAction = "com.thomasrooney.herdrdeck.newspace"
)

const (
	offlineAfterFailures = 3
	focusPendingTimeout  = 5 * time.Second
	focusFailureFlash    = time.Second
)

type instance struct {
	context string
	action  string
	row     int
	column  int
}

type keyRole int

const (
	roleSpace keyRole = iota
	rolePagerLeft
	rolePagerRight
	roleNewSpace
	roleInert
)

type app struct {
	mu     sync.Mutex
	client *deck.Client
	bridge *herdr.Bridge

	instances map[string]instance
	rendered  map[string]string
	roles     map[string]keyRole
	assigned  map[string]string // context -> workspace ID

	assignment    layout.Assignment
	page          int
	snapshot      *herdr.Snapshot
	failures      int
	everConnected bool
	lastFocusedWS string

	pendingFocusWS string
	pendingSince   time.Time
	failedWS       string
	failedUntil    time.Time
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

	a := &app{
		client:    client,
		bridge:    herdr.NewBridge(),
		instances: map[string]instance{},
		rendered:  map[string]string{},
		roles:     map[string]keyRole{},
		assigned:  map[string]string{},
	}

	go func() {
		for {
			a.poll()
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
			if event.Action != spaceAction && event.Action != newSpaceAction {
				continue
			}
			a.mu.Lock()
			a.instances[event.Context] = instance{
				context: event.Context,
				action:  event.Action,
				row:     event.Payload.Coordinates.Row,
				column:  event.Payload.Coordinates.Column,
			}
			delete(a.rendered, event.Context)
			a.render()
			a.mu.Unlock()
		case "willDisappear":
			a.mu.Lock()
			delete(a.instances, event.Context)
			delete(a.rendered, event.Context)
			delete(a.roles, event.Context)
			delete(a.assigned, event.Context)
			a.render()
			a.mu.Unlock()
		case "keyUp":
			a.keyUp(event.Context)
		}
	}
}

func (a *app) poll() {
	a.mu.Lock()
	defer a.mu.Unlock()
	snapshot, err := a.bridge.Snapshot()
	if err != nil {
		a.failures++
		// Keep the last good frame through two failed polls to avoid flicker.
		if a.failures == offlineAfterFailures {
			a.render()
		}
		return
	}
	a.failures = 0
	a.everConnected = true
	a.snapshot = snapshot
	if a.pendingFocusWS != "" {
		if a.focusedWorkspaceID() == a.pendingFocusWS || time.Since(a.pendingSince) > focusPendingTimeout {
			a.pendingFocusWS = ""
		}
	}
	a.render()
}

func (a *app) focusedWorkspaceID() string {
	if a.snapshot == nil {
		return ""
	}
	for _, space := range a.snapshot.Workspaces {
		if space.Focused {
			return space.WorkspaceID
		}
	}
	return ""
}

func (a *app) orderedInstances() []instance {
	ordered := make([]instance, 0, len(a.instances))
	for _, inst := range a.instances {
		ordered = append(ordered, inst)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].row != ordered[j].row {
			return ordered[i].row < ordered[j].row
		}
		return ordered[i].column < ordered[j].column
	})
	return ordered
}

func sortedSpaces(snapshot *herdr.Snapshot) []herdr.Workspace {
	spaces := make([]herdr.Workspace, len(snapshot.Workspaces))
	copy(spaces, snapshot.Workspaces)
	sort.SliceStable(spaces, func(i, j int) bool {
		if spaces[i].Number != spaces[j].Number {
			return spaces[i].Number < spaces[j].Number
		}
		return spaces[i].WorkspaceID < spaces[j].WorkspaceID
	})
	return spaces
}

// render assumes a.mu is held.
func (a *app) render() {
	all := a.orderedInstances()
	if len(all) == 0 {
		return
	}
	for context := range a.roles {
		a.roles[context] = roleInert
	}
	for context := range a.assigned {
		delete(a.assigned, context)
	}

	ordered := make([]instance, 0, len(all))
	ready := a.everConnected && a.snapshot != nil && a.failures < offlineAfterFailures
	for _, inst := range all {
		if inst.action == newSpaceAction {
			if ready {
				a.roles[inst.context] = roleNewSpace
			}
			a.setImage(inst.context, render.NewSpaceTile(!ready))
			continue
		}
		ordered = append(ordered, inst)
	}
	if len(ordered) == 0 {
		return
	}

	if !a.everConnected || a.snapshot == nil {
		a.setImage(ordered[0].context, render.ConnectingTile())
		for _, inst := range ordered[1:] {
			a.setImage(inst.context, render.EmptyTile())
		}
		return
	}

	offline := a.failures >= offlineAfterFailures
	spaces := sortedSpaces(a.snapshot)
	if len(spaces) == 0 && !offline {
		a.setImage(ordered[0].context, render.NoSpacesTile())
		for _, inst := range ordered[1:] {
			a.setImage(inst.context, render.EmptyTile())
		}
		return
	}

	ids := make([]string, len(spaces))
	byID := make(map[string]herdr.Workspace, len(spaces))
	for i, space := range spaces {
		ids[i] = space.WorkspaceID
		byID[space.WorkspaceID] = space
	}
	slots := a.assignment.Update(ids)

	keys := len(ordered)
	pagerOn := layout.PagerActive(len(slots), keys)
	pageSize := layout.PageSize(keys, pagerOn)
	pageCount := layout.PageCount(len(slots), pageSize)

	focusedWS := a.focusedWorkspaceID()
	if focusedWS != "" && focusedWS != a.lastFocusedWS {
		for index, id := range slots {
			if id == focusedWS {
				a.page = layout.PageOf(index, pageSize)
			}
		}
	}
	a.lastFocusedWS = focusedWS
	a.page = layout.Clamp(a.page, pageCount)

	focusedIndex := -1
	for index, id := range slots {
		if id == focusedWS {
			focusedIndex = index
		}
	}
	start, end := layout.VisibleRange(a.page, pageSize, len(slots))
	visible := slots[start:end]

	contentKeys := ordered
	if pagerOn {
		contentKeys = ordered[:keys-2]
	}
	for i, inst := range contentKeys {
		if i >= len(visible) {
			a.setImage(inst.context, render.EmptyTile())
			continue
		}
		space := byID[visible[i]]
		opt := render.TileOpts{Dim: offline}
		if !offline {
			a.roles[inst.context] = roleSpace
			a.assigned[inst.context] = space.WorkspaceID
			now := time.Now()
			switch {
			case space.WorkspaceID == a.failedWS && now.Before(a.failedUntil):
				opt.Footer, opt.FooterRed = "FAILED · TRY AGAIN", true
			case space.WorkspaceID == a.pendingFocusWS && !space.Focused && now.Sub(a.pendingSince) < focusPendingTimeout:
				opt.Footer = "FOCUSING…"
			}
		}
		a.setImage(inst.context, render.SpaceTile(space, herdr.GitInfoFor(a.snapshot.WorkingDir(space)), opt))
	}
	if pagerOn {
		left, right := ordered[keys-2], ordered[keys-1]
		accentLeft := focusedIndex >= 0 && layout.PageOf(focusedIndex, pageSize) < a.page
		accentRight := focusedIndex >= 0 && layout.PageOf(focusedIndex, pageSize) > a.page
		if !offline {
			a.roles[left.context] = rolePagerLeft
			a.roles[right.context] = rolePagerRight
		}
		a.setImage(left.context, render.PagerTile(true, a.page+1, pageCount, accentLeft, offline))
		a.setImage(right.context, render.PagerTile(false, a.page+1, pageCount, accentRight, offline))
	}
	if offline {
		a.setImage(ordered[0].context, render.OfflineTile())
	}
}

// setImage assumes a.mu is held.
func (a *app) setImage(context, image string) {
	if a.rendered[context] == image {
		return
	}
	if err := a.client.SetImage(context, image); err == nil {
		a.rendered[context] = image
	}
}

func (a *app) keyUp(context string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch a.roles[context] {
	case rolePagerLeft:
		a.page--
		a.render()
	case rolePagerRight:
		a.page++
		a.render()
	case roleSpace:
		workspaceID, ok := a.assigned[context]
		if !ok {
			return
		}
		a.pendingFocusWS = workspaceID
		a.pendingSince = time.Now()
		a.render()
		go a.focus(workspaceID)
	case roleNewSpace:
		go func() {
			err := a.bridge.CreateWorkspace()
			if err == nil {
				err = herdr.RaiseClient()
			}
			if err != nil {
				_ = a.client.ShowAlert(context)
				_ = a.client.LogMessage("create workspace failed: " + err.Error())
			}
		}()
	}
}

func (a *app) focus(workspaceID string) {
	err := a.bridge.FocusWorkspace(workspaceID)
	if err == nil {
		err = herdr.RaiseClient()
	}
	if err != nil {
		a.mu.Lock()
		a.pendingFocusWS = ""
		a.failedWS = workspaceID
		a.failedUntil = time.Now().Add(focusFailureFlash)
		a.render()
		a.mu.Unlock()
		_ = a.client.LogMessage("focus " + workspaceID + " failed: " + err.Error())
		time.AfterFunc(focusFailureFlash+100*time.Millisecond, func() {
			a.mu.Lock()
			a.render()
			a.mu.Unlock()
		})
	}
}
