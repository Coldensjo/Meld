//go:build windows

package blender

import "syscall"

var allowSetForegroundWindow = syscall.NewLazyDLL("user32.dll").NewProc("AllowSetForegroundWindow")

// asfwAny is ASFW_ANY: any process may bring its window to the front.
const asfwAny = ^uintptr(0)

// allowForeground lets Blender's window open in front of the editor. Windows lets only the process the
// user works in do that, and Blender's window belongs to the program its launcher starts, whose id the
// editor never sees, so the right goes to any process. A failure only costs that.
func allowForeground() {
	_, _, _ = allowSetForegroundWindow.Call(asfwAny)
}
