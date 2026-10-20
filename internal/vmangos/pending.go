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
		if err := os.WriteFile(tmp, data, 0o644); err != nil {
			return err
		}
		if err := os.Rename(tmp, filepath.Join(dir, pendingName(f.Name))); err != nil {
			return err
		}
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
		}
	}
	return nil
}

// pendingFile is a waiting file's data, when one waits under name.
func pendingFile(dataDir, name string) ([]byte, bool) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	b, err := os.ReadFile(filepath.Join(pendingDir(dataDir), pendingName(name)))
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
