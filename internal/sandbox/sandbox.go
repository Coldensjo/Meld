// Package sandbox makes a throwaway copy of a client's Data folder for the probes (#368): a feature
// that writes Meld's patch can then be checked in the live app without changing the real client.
//
// The copy is cheap: every archive but Meld's patch is a hard link (or, where the folders are on
// different volumes, a symbolic link) to the real one, and only the patch is copied. Meld writes
// nothing but its patch into the Data folder, and it writes that by renaming a new file over it, so
// a link is never written through. The copy stays between probes; each Prepare links the archives
// that changed and copies the patch afresh, so whatever a probe wrote is gone.
package sandbox

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Patch is the archive Meld writes, the one the copy holds a copy of rather than a link to (as
// vmangos.PatchName).
const Patch = "patch-3.MPQ"

// Prepare makes or refreshes the copy of the Data folder realData under root, and returns the copy's
// Data folder. It fails rather than leave a copy whose patch is the real file.
func Prepare(realData, root string) (string, error) {
	data := filepath.Join(root, "Data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		return "", err
	}
	real, err := archives(realData)
	if err != nil {
		return "", err
	}
	if len(real) == 0 {
		return "", fmt.Errorf("%s holds no MPQ archives", realData)
	}
	have, err := os.ReadDir(data)
	if err != nil {
		return "", err
	}
	// Everything the copy holds that isn't one of the real archives goes, Meld's patch and what a
	// probe left beside it (a backup, a .tmp) too.
	for _, e := range have {
		name := e.Name()
		if _, ok := real[strings.ToLower(name)]; ok && !strings.EqualFold(name, Patch) {
			continue
		}
		if err := retry(func() error { return os.RemoveAll(filepath.Join(data, name)) }); err != nil {
			return "", err
		}
	}
	for _, name := range real {
		src, dst := filepath.Join(realData, name), filepath.Join(data, name)
		if strings.EqualFold(name, Patch) {
			if err := copyFile(src, dst); err != nil {
				return "", err
			}
			continue
		}
		if err := link(src, dst); err != nil {
			return "", err
		}
	}
	if err := check(realData, data); err != nil {
		return "", err
	}
	return data, nil
}

// archives lists the MPQ archives directly in dir, by lower-case name.
func archives(dir string) (map[string]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(filepath.Ext(e.Name()), ".mpq") {
			out[strings.ToLower(e.Name())] = e.Name()
		}
	}
	return out, nil
}

// link makes dst the same file as src, unless it already is: a hard link, else a symbolic one.
func link(src, dst string) error {
	si, err := os.Stat(src)
	if err != nil {
		return err
	}
	if di, err := os.Stat(dst); err == nil {
		if os.SameFile(si, di) {
			return nil
		}
		if err := retry(func() error { return os.Remove(dst) }); err != nil {
			return err
		}
	} else if _, lerr := os.Lstat(dst); lerr == nil {
		// A symbolic link whose file is gone.
		if err := retry(func() error { return os.Remove(dst) }); err != nil {
			return err
		}
	}
	hard := os.Link(src, dst)
	if hard == nil {
		return nil
	}
	if soft := os.Symlink(src, dst); soft != nil {
		return fmt.Errorf("cannot link %s into the throwaway client: %w", filepath.Base(src), errors.Join(hard, soft))
	}
	return nil
}

// copyFile copies src to dst through a temporary file renamed over it.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return retry(func() error { return os.Rename(tmp, dst) })
}

// Retry settings for retry: on Windows a virus scanner or the search indexer may hold a file it has
// just seen written for a moment (#384).
var (
	retryTries = 10
	retryWait  = 300 * time.Millisecond
)

// retry runs op, and on Windows runs it again, up to retryTries times retryWait apart, while it
// fails because another process holds the file. Elsewhere it runs op once.
func retry(op func() error) error {
	err := op()
	if runtime.GOOS != "windows" {
		return err
	}
	for i := 1; err != nil && !errors.Is(err, os.ErrNotExist) && i < retryTries; i++ {
		time.Sleep(retryWait)
		err = op()
	}
	return err
}

// check makes sure the copy's patch is a file of its own, so writing it can't change the real one.
func check(realData, data string) error {
	ri, err := os.Stat(filepath.Join(realData, Patch))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	di, err := os.Lstat(filepath.Join(data, Patch))
	if err != nil {
		return err
	}
	if di.Mode()&os.ModeSymlink != 0 || os.SameFile(ri, di) {
		return fmt.Errorf("the throwaway client's %s is the real one; refusing to use it", Patch)
	}
	return nil
}

// Stamp is a file's size and modification time, to show that the real patch was left alone.
type Stamp struct {
	Size    int64 `json:"size"`
	ModTime int64 `json:"modTime"` // Unix ns
}

// StampOf is the stamp of the file at path, the zero stamp if there is none.
func StampOf(path string) Stamp {
	fi, err := os.Stat(path)
	if err != nil {
		return Stamp{}
	}
	return Stamp{Size: fi.Size(), ModTime: fi.ModTime().UnixNano()}
}
