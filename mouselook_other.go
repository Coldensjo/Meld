//go:build !windows

package main

// Elsewhere the frontend uses pointer lock (see mouselook_windows.go).

// MouseLookBegin remembers where the cursor is, for MouseLookRecenter and MouseLookEnd.
func (a *App) MouseLookBegin() bool { return false }

// MouseLookRecenter moves the cursor back to where MouseLookBegin found it.
func (a *App) MouseLookRecenter() {}

// MouseLookEnd puts the cursor back where the drag started.
func (a *App) MouseLookEnd() {}
