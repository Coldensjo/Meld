//go:build windows

package vmangos

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
)

// startProgram starts a program in a console window of its own, through cmd's start, as if it had been
// double-clicked. A server shuts down when its console input ends, and a process started by this one
// gets an empty input, so it can't be started directly. start gives it a real console, and the server
// keeps running after the editor exits.
func startProgram(dir, name string, args []string) error {
	return startProgramEnv(dir, name, args, nil)
}

// startProgramEnv is startProgram with `env` (KEY=value) added to the program's environment.
func startProgramEnv(dir, name string, args, env []string) error {
	quoted := []string{`/D "` + dir + `"`, `"` + name + `"`}
	for _, a := range args {
		quoted = append(quoted, `"`+a+`"`)
	}
	cmd := exec.Command("cmd.exe")
	if len(env) > 0 {
		// start hands cmd's environment on to the program.
		cmd.Env = append(os.Environ(), env...)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `cmd.exe /c start "" ` + strings.Join(quoted, " ")}
	// No output is captured: the started program inherits the pipe, and this would wait for it to exit.
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	return nil
}

// createNoWindow is the CREATE_NO_WINDOW process creation flag.
const createNoWindow = 0x08000000

// hideConsole keeps a console program run for its output (mariadb, tasklist, the extractors) from
// opening a console window: the editor has no console to share, so Windows gives each one its own,
// and a map's spawn queries flashed a row of them.
func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

// allowSetForegroundWindow is user32's AllowSetForegroundWindow.
var allowSetForegroundWindow = syscall.NewLazyDLL("user32.dll").NewProc("AllowSetForegroundWindow")

// allowForeground lets the process pid bring its window to the front. Windows lets only the process
// the user is working in do that, so the editor, in front when the user starts the game, hands the
// right on; without it the game's window opens behind the editor. A failure only costs that.
func allowForeground(pid int) {
	_, _, _ = allowSetForegroundWindow.Call(uintptr(pid))
}
