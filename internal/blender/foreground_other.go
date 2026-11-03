//go:build !windows

package blender

import "os/exec"

// allowForeground does nothing outside Windows, whose window managers bring a new window forward.
func allowForeground() {}

// hideConsole does nothing outside Windows, where a background program opens no window.
func hideConsole(*exec.Cmd) {}
