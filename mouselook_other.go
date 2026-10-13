//go:build !windows

package main

// Elsewhere the frontend uses pointer lock (see mouselook_windows.go).

func (a *App) MouseLookBegin() bool { return false }
func (a *App) MouseLookRecenter()   {}
func (a *App) MouseLookEnd()        {}
