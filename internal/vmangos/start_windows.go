//go:build windows

package vmangos

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

// startProgram starts a program in a console window of its own, through cmd's start, as if it had been
// double-clicked. A server shuts down when its console input ends, and a process started by this one
// gets an empty input, so it can't be started directly. start gives it a real console, and the server
// keeps running after the editor exits.
func startProgram(dir, name string, args []string) error {
	quoted := []string{`/D "` + dir + `"`, `"` + name + `"`}
	for _, a := range args {
		quoted = append(quoted, `"`+a+`"`)
	}
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `cmd.exe /c start "" ` + strings.Join(quoted, " ")}
	// No output is captured: the started program inherits the pipe, and this would wait for it to exit.
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	return nil
}
