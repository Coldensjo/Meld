//go:build !windows

package play

// allowForeground does nothing here: only Windows keeps a program from bringing its window to the front.
func allowForeground(int) {}
