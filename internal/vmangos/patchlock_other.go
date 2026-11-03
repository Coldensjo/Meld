//go:build !windows

package vmangos

import (
	"errors"
	"os"
	"syscall"
)

// lockHandle waits for the exclusive flock on f. An flock belongs to the open file, so another open of
// the file in this process waits too.
func lockHandle(f *os.File) error {
	for {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX)
		if !errors.Is(err, syscall.EINTR) {
			return err
		}
	}
}

// unlockHandle lets go of the lock lockHandle took.
func unlockHandle(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}
