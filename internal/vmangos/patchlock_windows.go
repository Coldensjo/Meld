package vmangos

import (
	"os"
	"syscall"
	"unsafe"
)

// LockFileEx and UnlockFileEx, which the standard library's syscall package doesn't wrap on Windows;
// called through kernel32 rather than golang.org/x/sys, so no module is added.
var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx   = kernel32.NewProc("LockFileEx")
	procUnlockFileEx = kernel32.NewProc("UnlockFileEx")
)

const lockfileExclusiveLock = 0x2

// lockHandle waits for the exclusive lock on f's first byte. Windows locks are per handle, so another
// handle in this process waits too.
func lockHandle(f *os.File) error {
	var ol syscall.Overlapped
	r, _, err := procLockFileEx.Call(f.Fd(), lockfileExclusiveLock, 0, 1, 0, uintptr(unsafe.Pointer(&ol)))
	if r == 0 {
		return err
	}
	return nil
}

// unlockHandle lets go of the lock lockHandle took.
func unlockHandle(f *os.File) error {
	var ol syscall.Overlapped
	r, _, err := procUnlockFileEx.Call(f.Fd(), 0, 1, 0, uintptr(unsafe.Pointer(&ol)))
	if r == 0 {
		return err
	}
	return nil
}
