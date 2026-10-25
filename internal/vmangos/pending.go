package vmangos

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"Meld/internal/mpq"
)

// Client files waiting for the game to close (#365). On Windows the running game holds Meld's patch
// open, so a save that only adds rows to the client's tables (the spell editor's Spell.dbc,
// SpellIcon.dbc and visual tables) doesn't close the game: its files wait in the user's cache, one
// folder a client data folder, and are written into the patch once the game has closed. Meld's own
// reads of those tables see the waiting files first (readOverlay), so the next save builds on them and
// the editors show what was saved.

var pendingMu sync.Mutex

// pendingSet is the names of the waiting files (pendingName) of each client data folder's folder,
// read from disk once and kept up to date by AddPending, ClearPending and DropPending, so the asset
// server's icon previews don't touch the disk for a name nothing waits under (#485). It is reread
// when pendingRoot changes (the tests). Guarded by pendingMu.
var pendingSet struct {
	root string
	dirs map[string]map[string]bool
}

// pendingNames is the set of names waiting in dir, loading every folder's from disk on first use.
// The caller holds pendingMu.
func pendingNames(dir string) map[string]bool {
	loadPending()
	return pendingSet.dirs[dir]
}

// loadPending fills pendingSet from disk when it is empty or pendingRoot moved. The caller holds
// pendingMu.
func loadPending() {
	root := pendingRoot()
	if pendingSet.dirs != nil && pendingSet.root == root {
		return
	}
	pendingSet.root, pendingSet.dirs = root, map[string]map[string]bool{}
	subs, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, sub := range subs {
		if !sub.IsDir() {
			continue
		}
		dir := filepath.Join(root, sub.Name())
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") {
				continue
			}
			if pendingSet.dirs[dir] == nil {
				pendingSet.dirs[dir] = map[string]bool{}
			}
			pendingSet.dirs[dir][e.Name()] = true
		}
	}
}

// AnyPending says whether any file waits for any client data folder, without touching the disk
// after the first call.
func AnyPending() bool {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	loadPending()
	for _, names := range pendingSet.dirs {
		if len(names) > 0 {
			return true
		}
	}
	return false
}

// pendingRoot is the folder the waiting files are kept in; a variable for the tests.
var pendingRoot = func() string {
	d, err := os.UserCacheDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "Meld", "pending-client")
}

// pendingDir is the folder of a client data folder's waiting files.
func pendingDir(dataDir string) string {
	sum := sha1.Sum([]byte(strings.ToLower(filepath.Clean(dataDir))))
	return filepath.Join(pendingRoot(), hex.EncodeToString(sum[:6]))
}

// pendingName is a client file's name as a file name of its own (base64 of the archive path).
func pendingName(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strings.ToLower(name)))
}

// AddPending keeps files to be written into the patch once the game has closed, each replacing a
// waiting file of the same name.
func AddPending(dataDir string, files []mpq.File) error {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, f := range files {
		// The archive path first, then the data: the file name holds it lower case only.
		data := append(append([]byte(f.Name), 0), f.Data...)
		tmp := filepath.Join(dir, pendingName(f.Name)+".tmp")
		if err := writeSynced(tmp, data); err != nil {
			return err
		}
		if err := os.Rename(tmp, filepath.Join(dir, pendingName(f.Name))); err != nil {
			_ = os.Remove(tmp)
			return err
		}
		loadPending()
		if pendingSet.dirs[dir] == nil {
			pendingSet.dirs[dir] = map[string]bool{}
		}
		pendingSet.dirs[dir][pendingName(f.Name)] = true
	}
	// Meld's reader serves them through its overlay now, so it forgets what it decoded before (#471).
	if r := heldReader(); r != nil {
		names := make([]string, len(files))
		for i, f := range files {
			names[i] = f.Name
		}
		r.Forget(names...)
	}
	return nil
}

// PendingFiles lists the files waiting for a client data folder, by name.
func PendingFiles(dataDir string) ([]mpq.File, error) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	entries, err := os.ReadDir(pendingDir(dataDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []mpq.File
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(pendingDir(dataDir), e.Name()))
		if err != nil {
			return nil, err
		}
		name, data, ok := strings.Cut(string(b), "\x00")
		if !ok {
			continue
		}
		out = append(out, mpq.File{Name: name, Data: []byte(data)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// DropPending drops every file waiting for a client data folder, unwritten: the probes' throwaway
// client starts each time without what a probe left waiting (#368).
func DropPending(dataDir string) error {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	loadPending()
	delete(pendingSet.dirs, dir)
	return os.RemoveAll(dir)
}

// ClearPending drops the waiting files of a client data folder that are the ones in written (by
// name and content), after they went into the patch; a file saved again meanwhile stays.
func ClearPending(dataDir string, written []mpq.File) error {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	for _, f := range written {
		path := filepath.Join(pendingDir(dataDir), pendingName(f.Name))
		b, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if string(b) == f.Name+"\x00"+string(f.Data) {
			if err := os.Remove(path); err != nil {
				return err
			}
			delete(pendingSet.dirs[pendingDir(dataDir)], pendingName(f.Name))
		}
	}
	return nil
}

// pendingFile is a waiting file's data, when one waits under name.
func pendingFile(dataDir, name string) ([]byte, bool) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir, key := pendingDir(dataDir), pendingName(name)
	if !pendingNames(dir)[key] {
		return nil, false
	}
	b, err := os.ReadFile(filepath.Join(dir, key))
	if err != nil {
		return nil, false
	}
	_, data, ok := strings.Cut(string(b), "\x00")
	return []byte(data), ok
}

// readOverlay reads a client file as the game will see it once the waiting files are written: the
// waiting one, else the archives' (Meld's patch included).
func readOverlay(set *mpq.Set, dataDir, name string) ([]byte, error) {
	if b, ok := pendingFile(dataDir, name); ok {
		return b, nil
	}
	return set.ReadFile(name)
}

// InstallWithPending writes files into the patch with the files waiting for the game to close
// (#365) taken along, then drops the waiting ones it wrote. Reading the waiting files, the write and
// the drop hold patchMu together, so no other write can slip between them (#657). With nothing given
// and nothing waiting it writes nothing and returns "".
func InstallWithPending(dataDir string, files []mpq.File) (string, error) {
	patchMu.Lock()
	defer patchMu.Unlock()
	pending, err := PendingFiles(dataDir)
	if err != nil {
		return "", err
	}
	if len(pending) == 0 && len(files) == 0 {
		return "", nil
	}
	patch, err := installPatch(dataDir, WithPending(pending, files))
	if err != nil || len(pending) == 0 {
		return patch, err
	}
	err = ClearPending(dataDir, pending)
	ForgetSpells()
	return patch, err
}

// WithPending is files with the waiting ones of the same client in front, a file in files replacing
// a waiting one of its name, for a patch write that takes the waiting files along.
func WithPending(pending, files []mpq.File) []mpq.File {
	given := map[string]bool{}
	for _, f := range files {
		given[strings.ToLower(f.Name)] = true
	}
	out := make([]mpq.File, 0, len(pending)+len(files))
	for _, f := range pending {
		if !given[strings.ToLower(f.Name)] {
			out = append(out, f)
		}
	}
	return append(out, files...)
}
