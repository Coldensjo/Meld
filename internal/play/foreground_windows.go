//go:build windows

package play

import "syscall"

// allowSetForegroundWindow is user32's AllowSetForegroundWindow.
var allowSetForegroundWindow = syscall.NewLazyDLL("user32.dll").NewProc("AllowSetForegroundWindow")

// allowForeground lets the process pid bring its window to the front. Windows lets only the process
// the user is working in do that, so the editor, in front when the user starts the game, hands the
// right on; without it the game's window opens behind the editor. A failure only costs that.
func allowForeground(pid int) {
	_, _, _ = allowSetForegroundWindow.Call(uintptr(pid))
}
