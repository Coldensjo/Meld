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

// lockedErr is lockedError's error, so InUse can tell it from a failure a retry won't fix.
type lockedErr struct{ name string }

func (e *lockedErr) Error() string {
	return fmt.Sprintf("%s is in use by another program or is read-only. Close World of Warcraft and the server, check the file is not read-only, then export again", e.name)
}

// lockedError says what to do about a file that couldn't be written.
func lockedError(path string) error {
	return &lockedErr{name: filepath.Base(path)}
}

// InUse reports whether a write failed only because a file was held open elsewhere (or read-only),
// which may pass once that program lets go, rather than for a reason a retry won't fix (#481).
func InUse(err error) bool {
	var l *lockedErr
	return errors.As(err, &l) || inUse(err)
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

// writeSynced writes data to path and syncs it to disk before closing it, removing the file when any
// step fails. The callers rename it over a real file next, and a rename the file system journals
// before the data reaches the disk would leave that file empty after a power loss (#638, #649).
func writeSynced(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(path)
	}
	return err
}

// replaceFile renames tmp over target. A target that is locked is reported as such, and tmp is removed.
func replaceFile(tmp, target string) error {
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		if inUse(err) {
			return lockedError(target)
		}
		return err
	}
	return nil
}
