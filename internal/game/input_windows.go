//go:build windows

package game

import (
	"errors"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32          = syscall.NewLazyDLL("user32.dll")
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procFindWindow  = user32.NewProc("FindWindowW")
	procSetFore     = user32.NewProc("SetForegroundWindow")
	procForeground  = user32.NewProc("GetForegroundWindow")
	procWindowTID   = user32.NewProc("GetWindowThreadProcessId")
	procAttachInput = user32.NewProc("AttachThreadInput")
	procSendInput   = user32.NewProc("SendInput")
	procThreadID    = kernel32.NewProc("GetCurrentThreadId")
)

const (
	keyeventfKeyUp   = 0x0002
	keyeventfUnicode = 0x0004

	// strokeGap spaces the key presses out, since the client drops presses that come too fast.
	strokeGap = 15 * time.Millisecond
)

// keybdInput and input match the Win32 KEYBDINPUT and INPUT structs on 64-bit Windows. INPUT's union is
// as large as MOUSEINPUT, which is why input has the trailing bytes: the struct is 40 bytes.
type keybdInput struct {
	vk    uint16
	scan  uint16
	flags uint32
	time  uint32
	extra uintptr
}

type input struct {
	typ uint32
	ki  keybdInput
	_   [8]byte
}

// findWindow waits until a window with exactly this title exists, and returns its handle, or 0.
func findWindow(title string, timeout time.Duration) uintptr {
	p, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return 0
	}
	deadline := time.Now().Add(timeout)
	for {
		h, _, _ := procFindWindow.Call(0, uintptr(unsafe.Pointer(p)))
		if h != 0 {
			return h
		}
		if time.Now().After(deadline) {
			return 0
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// typeInto brings hwnd to the front and sends the strokes to it. Before each stroke it checks that hwnd
// still has focus, and stops if it doesn't, so keys never go to another window.
func typeInto(hwnd uintptr, strokes []stroke) error {
	if err := focus(hwnd); err != nil {
		return err
	}
	for _, s := range strokes {
		if foreground() != hwnd {
			return errors.New("the World of Warcraft window lost focus, so the login was stopped")
		}
		if err := sendStroke(s); err != nil {
			return err
		}
		time.Sleep(strokeGap)
	}
	return nil
}

// focus makes hwnd the foreground window. Windows only lets a program do that when it's the one
// receiving input, so this attaches to the current foreground thread first.
func focus(hwnd uintptr) error {
	fg := foreground()
	fgThread, _, _ := procWindowTID.Call(fg, 0)
	me, _, _ := procThreadID.Call()
	procAttachInput.Call(me, fgThread, 1)
	procSetFore.Call(hwnd)
	procAttachInput.Call(me, fgThread, 0)
	time.Sleep(200 * time.Millisecond)
	if foreground() != hwnd {
		return errors.New("could not bring the World of Warcraft window to the front")
	}
	return nil
}

func foreground() uintptr {
	h, _, _ := procForeground.Call()
	return h
}

// sendStroke presses and releases one key. A character goes in as Unicode, so it needs no key mapping.
func sendStroke(s stroke) error {
	down := input{typ: 1, ki: keybdInput{vk: s.vk}}
	up := input{typ: 1, ki: keybdInput{vk: s.vk, flags: keyeventfKeyUp}}
	if s.char != 0 {
		down.ki = keybdInput{scan: uint16(s.char), flags: keyeventfUnicode}
		up.ki = keybdInput{scan: uint16(s.char), flags: keyeventfUnicode | keyeventfKeyUp}
	}
	events := [2]input{down, up}
	n, _, err := procSendInput.Call(2, uintptr(unsafe.Pointer(&events[0])), unsafe.Sizeof(events[0]))
	if n != 2 {
		if err != nil {
			return err
		}
		return errors.New("the key press was not sent")
	}
	return nil
}
