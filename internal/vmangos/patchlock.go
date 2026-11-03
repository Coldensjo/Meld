package vmangos

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// LockSuffix is added to Meld's patch for the file its writers lock (#1079): patchMu and pendingMu
// serialise the writes of one process only, and meldtool's record writes (#1055) write the same patch
// and waiting files from another. The file sits beside the patch, so the lock is per client Data
// folder (the probes' sandbox client never waits on the owner's game); the client and Meld's reader
// load only *.MPQ, so they never see it. It stays there empty: removing it after each write would let
// a writer lock a file the next one no longer opens.
const LockSuffix = ".lock"

// lockedFile is a file this process holds the exclusive lock on, across processes.
type lockedFile struct{ f *os.File }

// lockFile opens (creating) the file at path and waits until this process holds its exclusive lock.
// The lock ends at unlock, or with the process, so a writer that crashed never leaves it held.
func lockFile(path string) (*lockedFile, error) {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, err
	}
	if err := lockHandle(f); err != nil {
		_ = f.Close()
		return nil, err
	}
	return &lockedFile{f}, nil
}

// unlock lets the next writer have the lock.
func (l *lockedFile) unlock() {
	_ = unlockHandle(l.f)
	_ = l.f.Close()
}

// lockClient takes the lock of dataDir's patch and waiting files across processes, and returns its
// release. Take it after patchMu and before pendingMu, and only once in a call: a second take in the
// same goroutine would wait on itself. A Data folder that does not exist has nothing to race over, so
// it is not locked.
func lockClient(dataDir string) (func(), error) {
	path := PatchPath(dataDir) + LockSuffix
	l, err := lockFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return func() {}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cannot lock %s: %w", filepath.Base(path), err)
	}
	return l.unlock, nil
}

// lockPatch takes patchMu and the cross-process lock for a write of dataDir's patch, and returns
// their release.
func lockPatch(dataDir string) (func(), error) {
	patchMu.Lock()
	unlock, err := lockClient(dataDir)
	if err != nil {
		patchMu.Unlock()
		return nil, err
	}
	return func() {
		unlock()
		patchMu.Unlock()
	}, nil
}
