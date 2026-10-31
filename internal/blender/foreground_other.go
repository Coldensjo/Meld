//go:build !windows

package blender

// allowForeground does nothing outside Windows, whose window managers bring a new window forward.
func allowForeground() {}
