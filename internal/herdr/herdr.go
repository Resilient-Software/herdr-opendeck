// Package herdr talks to the herdr CLI to observe and control the current
// Herdr session.
package herdr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type AgentStatus string

const (
	StatusIdle    AgentStatus = "idle"
	StatusWorking AgentStatus = "working"
	StatusBlocked AgentStatus = "blocked"
	StatusDone    AgentStatus = "done"
	StatusUnknown AgentStatus = "unknown"
)

type Pane struct {
	PaneID        string      `json:"pane_id"`
	Agent         string      `json:"agent"`
	AgentStatus   AgentStatus `json:"agent_status"`
	Focused       bool        `json:"focused"`
	Label         string      `json:"label"`
	TerminalTitle string      `json:"terminal_title_stripped"`
	Cwd           string      `json:"cwd"`
	WorkspaceID   string      `json:"workspace_id"`
}

type Workspace struct {
	WorkspaceID string      `json:"workspace_id"`
	Number      int         `json:"number"`
	Label       string      `json:"label"`
	AgentStatus AgentStatus `json:"agent_status"`
	PaneCount   int         `json:"pane_count"`
	TabCount    int         `json:"tab_count"`
	Focused     bool        `json:"focused"`
	Worktree    *Worktree   `json:"worktree"`
}

type Worktree struct {
	CheckoutPath string `json:"checkout_path"`
	RepoName     string `json:"repo_name"`
}

type Snapshot struct {
	FocusedPaneID string      `json:"focused_pane_id"`
	Panes         []Pane      `json:"panes"`
	Workspaces    []Workspace `json:"workspaces"`
}

type Bridge struct {
	binary  string
	timeout time.Duration
}

func NewBridge() *Bridge {
	binary := os.Getenv("HERDR_PATH")
	if binary == "" {
		// The installer records the herdr path at the plugin root, since the
		// host application may run with a minimal PATH.
		if executable, err := os.Executable(); err == nil {
			recorded, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "..", "..", "herdr-path.txt"))
			if err == nil && len(bytes.TrimSpace(recorded)) > 0 {
				binary = string(bytes.TrimSpace(recorded))
			}
		}
	}
	if binary == "" {
		binary = "herdr"
	}
	return &Bridge{binary: binary, timeout: 2500 * time.Millisecond}
}

func (b *Bridge) run(args ...string) ([]byte, error) {
	cmd := exec.Command(b.binary, args...)
	done := make(chan struct{})
	var out []byte
	var err error
	go func() {
		out, err = cmd.Output()
		close(done)
	}()
	select {
	case <-done:
		return out, err
	case <-time.After(b.timeout):
		_ = cmd.Process.Kill()
		<-done
		return nil, fmt.Errorf("herdr %v timed out", args)
	}
}

func (b *Bridge) Snapshot() (*Snapshot, error) {
	out, err := b.run("api", "snapshot")
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Result struct {
			Snapshot *Snapshot `json:"snapshot"`
			// Some builds place the snapshot fields directly under result.
			FocusedPaneID string `json:"focused_pane_id"`
			Panes         []Pane `json:"panes"`
		} `json:"result"`
	}
	if err := json.Unmarshal(out, &envelope); err != nil {
		return nil, err
	}
	if envelope.Result.Snapshot != nil {
		return envelope.Result.Snapshot, nil
	}
	if envelope.Result.Panes != nil {
		return &Snapshot{FocusedPaneID: envelope.Result.FocusedPaneID, Panes: envelope.Result.Panes}, nil
	}
	return nil, fmt.Errorf("no snapshot in herdr api response")
}

// Agent panes use the agent surface; plain panes re-apply their current zoom
// state, which raises the client without changing layout.
func (b *Bridge) Focus(pane Pane) error {
	if pane.Agent != "" {
		_, err := b.run("agent", "focus", pane.PaneID)
		return err
	}
	out, err := b.run("pane", "layout", "--pane", pane.PaneID)
	if err != nil {
		return err
	}
	var layout struct {
		Result struct {
			Layout struct {
				Zoomed *bool `json:"zoomed"`
			} `json:"layout"`
		} `json:"result"`
	}
	if err := json.Unmarshal(out, &layout); err != nil {
		return err
	}
	if layout.Result.Layout.Zoomed == nil {
		return fmt.Errorf("invalid pane layout response")
	}
	flag := "--off"
	if *layout.Result.Layout.Zoomed {
		flag = "--on"
	}
	_, err = b.run("pane", "zoom", pane.PaneID, flag)
	return err
}

func (b *Bridge) FocusWorkspace(workspaceID string) error {
	_, err := b.run("workspace", "focus", workspaceID)
	return err
}

func (s *Snapshot) FirstWorkspace() *Workspace {
	var first *Workspace
	for i := range s.Workspaces {
		if first == nil || s.Workspaces[i].Number < first.Number {
			first = &s.Workspaces[i]
		}
	}
	return first
}

func (p Pane) DisplayLabel() string {
	if p.Label != "" {
		return p.Label
	}
	if p.TerminalTitle != "" {
		return p.TerminalTitle
	}
	if p.Cwd != "" {
		cwd := p.Cwd
		for len(cwd) > 0 && (cwd[len(cwd)-1] == '/' || cwd[len(cwd)-1] == '\\') {
			cwd = cwd[:len(cwd)-1]
		}
		for i := len(cwd) - 1; i >= 0; i-- {
			if cwd[i] == '/' || cwd[i] == '\\' {
				return cwd[i+1:]
			}
		}
		return cwd
	}
	return p.PaneID
}
