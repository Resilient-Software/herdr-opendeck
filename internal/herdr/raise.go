package herdr

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func RaiseClient() error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	app := hostingApp()
	if app == "" {
		return nil
	}
	return exec.Command("open", "-a", app).Run()
}

func hostingApp() string {
	out, err := exec.Command("ps", "-axo", "pid=,ppid=,command=").Output()
	if err != nil {
		return ""
	}
	type proc struct {
		ppid    int
		command string
	}
	procs := map[int]proc{}
	var clients []int
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		pid, err1 := strconv.Atoi(fields[0])
		ppid, err2 := strconv.Atoi(fields[1])
		if err1 != nil || err2 != nil {
			continue
		}
		command := strings.Join(fields[2:], " ")
		procs[pid] = proc{ppid: ppid, command: command}
		// The TUI client is a bare `herdr` (or `herdr --session ...` /
		// `herdr session attach ...`) with no other subcommand.
		base := fields[2]
		if idx := strings.LastIndex(base, "/"); idx >= 0 {
			base = base[idx+1:]
		}
		if base != "herdr" {
			continue
		}
		rest := fields[3:]
		if len(rest) == 0 || rest[0] == "--session" || (len(rest) > 1 && rest[0] == "session" && rest[1] == "attach") {
			clients = append(clients, pid)
		}
	}
	for _, pid := range clients {
		for depth := 0; depth < 20; depth++ {
			parent, ok := procs[pid]
			if !ok || pid <= 1 {
				break
			}
			if idx := strings.Index(parent.command, ".app/Contents/MacOS/"); idx >= 0 {
				return parent.command[:idx+4]
			}
			pid = parent.ppid
		}
	}
	return ""
}
