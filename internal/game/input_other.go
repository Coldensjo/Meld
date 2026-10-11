//go:build !windows

package game

import (
	"errors"
	"time"
)

// findWindow never finds a window: the client only runs on Windows.
func findWindow(title string, timeout time.Duration) uintptr {
	return 0
}

// typeInto can't type into a window off Windows.
func typeInto(hwnd uintptr, strokes []stroke) error {
	return errors.New("logging in to the game needs Windows")
}
