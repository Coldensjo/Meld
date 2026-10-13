package main

import (
	"sync"
	"syscall"
	"unsafe"
)

// Looking around with the right mouse button hides the cursor and keeps
// moving it back to where the drag started, so the camera never runs into
// the screen's edge. WebView2 would show a "Press Esc to show your cursor"
// banner on every pointer lock, so Windows does this natively instead.

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	procGetCursorPos = user32.NewProc("GetCursorPos")
	procSetCursorPos = user32.NewProc("SetCursorPos")
)

type point struct{ X, Y int32 }

var mouseLook struct {
	mu     sync.Mutex
	anchor point
}

// MouseLookBegin remembers where the cursor is, for MouseLookRecenter and MouseLookEnd.
func (a *App) MouseLookBegin() bool {
	mouseLook.mu.Lock()
	defer mouseLook.mu.Unlock()
	r, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&mouseLook.anchor)))
	return r != 0
}

// MouseLookRecenter moves the cursor back to where MouseLookBegin found it.
func (a *App) MouseLookRecenter() {
	mouseLook.mu.Lock()
	p := mouseLook.anchor
	mouseLook.mu.Unlock()
	procSetCursorPos.Call(uintptr(p.X), uintptr(p.Y))
}

// MouseLookEnd puts the cursor back where the drag started.
func (a *App) MouseLookEnd() {
	a.MouseLookRecenter()
}
