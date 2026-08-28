package herdr

import (
	"os/exec"
	"strings"
	"sync"
	"time"
)

type GitInfo struct {
	Repo   string // repository directory name, or the cwd's basename outside git
	Branch string // current branch, or short commit hash when detached; empty outside git
}

type cachedGitInfo struct {
	info    GitInfo
	fetched time.Time
}

var (
	gitCacheMu sync.Mutex
	gitCache   = map[string]cachedGitInfo{}
)

const gitCacheTTL = 5 * time.Second

func GitInfoFor(cwd string) GitInfo {
	if cwd == "" {
		return GitInfo{}
	}
	gitCacheMu.Lock()
	cached, ok := gitCache[cwd]
	gitCacheMu.Unlock()
	if ok && time.Since(cached.fetched) < gitCacheTTL {
		return cached.info
	}

	info := GitInfo{Repo: basename(cwd)}
	if top := gitOutput(cwd, "rev-parse", "--show-toplevel"); top != "" {
		info.Repo = basename(top)
		branch := gitOutput(cwd, "rev-parse", "--abbrev-ref", "HEAD")
		if branch == "HEAD" { // detached
			branch = gitOutput(cwd, "rev-parse", "--short", "HEAD")
		}
		info.Branch = branch
	}

	gitCacheMu.Lock()
	gitCache[cwd] = cachedGitInfo{info: info, fetched: time.Now()}
	gitCacheMu.Unlock()
	return info
}

func (s *Snapshot) WorkingDir(space Workspace) string {
	if space.Worktree != nil && space.Worktree.CheckoutPath != "" {
		return space.Worktree.CheckoutPath
	}
	for _, pane := range s.Panes {
		if pane.WorkspaceID == space.WorkspaceID && pane.Cwd != "" {
			return pane.Cwd
		}
	}
	return ""
}

func gitOutput(cwd string, args ...string) string {
	cmd := exec.Command("git", append([]string{"-C", cwd}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func basename(path string) string {
	trimmed := strings.TrimRight(path, "/\\")
	for i := len(trimmed) - 1; i >= 0; i-- {
		if trimmed[i] == '/' || trimmed[i] == '\\' {
			return trimmed[i+1:]
		}
	}
	return trimmed
}
