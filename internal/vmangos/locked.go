package vmangos

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
)

// sharingViolation is Windows' error when a file is open in another program in a way that stops this one.
const sharingViolation = syscall.Errno(32)

// inUse reports whether err means the file is held open elsewhere (or is read-only): Windows refuses
// to write or replace a file the game or the server has open.
func inUse(err error) bool {
	return errors.Is(err, fs.ErrPermission) || errors.Is(err, sharingViolation)
}

// lockedError says what to do about a file that couldn't be written.
func lockedError(path string) error {
	return fmt.Errorf("%s is in use by another program or is read-only. Close World of Warcraft and the server, check the file is not read-only, then export again", filepath.Base(path))
}

// checkFree fails when path exists and can't be opened for writing, before anything is written, so a
// locked file is reported straight away and the old file is left alone.
func checkFree(path string) error {
	if _, err := os.Stat(path); err != nil {
		return nil // nothing to replace
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		if inUse(err) {
			return lockedError(path)
		}
		return err
	}
	return f.Close()
}

// replaceFile renames tmp over target. A target that is locked is reported as such, and tmp is removed.
func replaceFile(tmp, target string) error {
	if err := os.Rename(tmp, target); err != nil {
		os.Remove(tmp)
		if inUse(err) {
			return lockedError(target)
		}
		return err
	}
	return nil
}
