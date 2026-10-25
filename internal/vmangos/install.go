package vmangos

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"Meld/internal/mpq"
	"Meld/internal/wow"
)

// PatchName is the client's patch archive that map edits go into. The VMaNGOS tools read
// patch-3 through patch-9 for the server's map data, so it's the one the server sees too.
const PatchName = "patch-3.MPQ"

// IronforgeMarker is the file Ironforge's exports carry. Its patch is replaced by Meld's,
// after a backup, since Meld takes over the same job.
const IronforgeMarker = "(ironforge)"

// BackupSuffix is added to an existing patch before Meld first replaces it.
const BackupSuffix = ".before-meld"

// PrevSuffix is added to the patch each write replaces, overwriting the one before (#475): the patch is
// the only copy of the client-table edits (spells, icons, lights, areas, taxis, world maps), so a
// write that drops entries by mistake can be undone by hand from it. The client and Meld's reader load
// only *.MPQ, so they never see it.
const PrevSuffix = ".prev"

// CheckServer reports whether dir looks like a VMaNGOS server folder: it has the configuration and
// the map data the update script writes.
func CheckServer(dir string) error {
	if _, err := os.Stat(filepath.Join(dir, "run", "mangosd.conf")); err != nil {
		return fmt.Errorf("%s has no run/mangosd.conf: not a VMaNGOS server folder", dir)
	}
	if info, err := os.Stat(filepath.Join(dir, "data")); err != nil || !info.IsDir() {
		return fmt.Errorf("%s has no data folder", dir)
	}
	return nil
}

// patchMu serialises Meld's writes of a patch (#657): each rebuilds the patch from the one on disk
// and renames the new one over it, so two at once (a Publish and the waiting files' watcher) would
// drop the files of whichever renamed first.
var patchMu sync.Mutex

// InstallPatch writes files as the client's patch archive in its Data folder. An archive that
// Meld or Ironforge wrote is replaced (Ironforge's after a backup); any other patch-3 is
// left alone, since it may be the game's. Returns the archive's path. One write runs at a time.
func InstallPatch(dataDir string, files []mpq.File) (string, error) {
	patchMu.Lock()
	defer patchMu.Unlock()
	return installPatch(dataDir, files)
}

// installPatch is InstallPatch, for a caller holding patchMu.
func installPatch(dataDir string, files []mpq.File) (string, error) {
	target := filepath.Join(dataDir, PatchName)
	// A patch the game has open can't be replaced: say so before anything is backed up or written.
	if err := checkFree(target); err != nil {
		return "", err
	}
	// The old patch is opened once: its owner, the files it carries over and their bytes all come from
	// this one handle, and the carried files are copied straight from it into the new patch rather
	// than read into memory first (#476).
	var old *mpq.Archive
	var keep []mpq.Entry
	if _, err := os.Stat(target); err == nil {
		if old, err = mpq.Open(target); err != nil {
			return "", fmt.Errorf("cannot read %s: %w", PatchName, err)
		}
		// Closed before the rename below; this is for the returns before it.
		defer old.Close()
		switch archiveOwnerOf(old) {
		case "":
			return "", fmt.Errorf("%s is not a patch Meld or Ironforge wrote; move it out of the Data folder first", PatchName)
		case IronforgeMarker:
			if err := backup(target, target+BackupSuffix); err != nil {
				return "", err
			}
		}
		// Tiles edited earlier stay in the patch; the ones given here replace theirs.
		if keep, err = carryOver(old, files); err != nil {
			return "", fmt.Errorf("cannot read %s: %w", PatchName, err)
		}
	}
	changed := make([]string, 0, len(files))
	for _, f := range files {
		changed = append(changed, f.Name)
	}
	if len(keep) > 0 {
		index, err := minimapIndex(old, files, keep)
		if err != nil {
			return "", fmt.Errorf("cannot read %s: %w", PatchName, err)
		}
		kept := dropUnusedMinimaps(append([]mpq.Entry(nil), keep...), index)
		changed = append(changed, droppedNames(keep, kept)...)
		keep = kept
	}

	// Written beside the target and renamed over it, so a failed write leaves the old patch.
	tmp := target + ".tmp"
	if err := writeArchive(tmp, append(mpq.Entries(files), keep...)); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	if old != nil {
		// Windows doesn't rename over a file still open.
		_ = old.Close()
	}
	// Meld's own reader lets go of the archives for the rename only, then forgets what it decoded
	// from the files this write changed (#471).
	reader := heldReader()
	if reader != nil {
		reader.Suspend()
	}
	err := replaceKeepingPrev(tmp, target, old != nil)
	if reader != nil {
		_ = reader.Resume()
		if err == nil {
			reader.Forget(changed...)
		}
	}
	if err != nil {
		return "", err
	}
	return target, nil
}

// replaceKeepingPrev renames tmp over target. When target exists (hadOld) it is first renamed to
// target+PrevSuffix, replacing the previous one, and put back if the second rename fails, so the
// patch is never left missing. tmp is removed on any failure.
func replaceKeepingPrev(tmp, target string, hadOld bool) error {
	if !hadOld {
		return replaceFile(tmp, target)
	}
	prev := target + PrevSuffix
	if err := os.Rename(target, prev); err != nil {
		_ = os.Remove(tmp)
		if inUse(err) {
			return lockedError(target)
		}
		return fmt.Errorf("cannot keep the previous %s as %s: %w", PatchName, filepath.Base(prev), err)
	}
	if err := replaceFile(tmp, target); err != nil {
		if rerr := os.Rename(prev, target); rerr != nil {
			return fmt.Errorf("%w (and the previous patch stays at %s: %v)", err, prev, rerr)
		}
		return err
	}
	return nil
}

// ClientReader is Meld's own reader of the client's archives (wow.Client), which holds Meld's patch
// open while it's loaded.
type ClientReader interface {
	// Suspend closes the archives until Resume.
	Suspend()
	// Resume opens them again.
	Resume() error
	// Forget drops what was decoded from the files at paths.
	Forget(paths ...string)
}

var (
	readerMu     sync.Mutex
	clientReader ClientReader
)

// SetClientReader names the reader InstallPatch closes while it replaces the patch and tells which
// files changed, and AddPending tells which files now wait (nil for none, as in the tests). The app
// sets it once at its start.
func SetClientReader(r ClientReader) {
	readerMu.Lock()
	clientReader = r
	readerMu.Unlock()
}

func heldReader() ClientReader {
	readerMu.Lock()
	defer readerMu.Unlock()
	return clientReader
}

// writeArchive writes the archive of files to path through a buffer, and syncs it to disk before
// closing it: the caller renames it over the patch, and a rename the file system journals before the
// file's data reaches the disk would leave a patch of zeros after a power loss (#638).
func writeArchive(path string, files []mpq.Entry) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	w := bufio.NewWriterSize(f, 1<<20)
	if err := mpq.WriteTo(w, files); err != nil {
		_ = f.Close()
		return err
	}
	if err := w.Flush(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// droppedNames lists the names of before that after no longer has.
func droppedNames(before, after []mpq.Entry) []string {
	left := make(map[string]bool, len(after))
	for _, f := range after {
		left[strings.ToUpper(f.Name)] = true
	}
	var out []string
	for _, f := range before {
		if !left[strings.ToUpper(f.Name)] {
			out = append(out, f.Name)
		}
	}
	return out
}

// carryOver lists the files of an existing patch that aren't in files, so replacing the patch keeps
// the tiles exported before. Their bytes are read from a only when the new patch is written. The
// archive's own marker and listfile are left out.
func carryOver(a *mpq.Archive, files []mpq.File) ([]mpq.Entry, error) {
	names, err := a.ListFile()
	if err != nil {
		return nil, err
	}
	replaced := make(map[string]bool, len(files))
	for _, f := range files {
		replaced[strings.ToUpper(strings.ReplaceAll(f.Name, "/", `\`))] = true
	}
	var out []mpq.Entry
	for _, name := range names {
		if name == "" || name[0] == '(' || replaced[strings.ToUpper(strings.ReplaceAll(name, "/", `\`))] {
			continue
		}
		r, size, err := a.Reader(name)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		out = append(out, mpq.Entry{Name: name, Size: size, Data: r})
	}
	return out, nil
}

// minimapIndex is the patch's minimap index after the write: the one in files, else the one carried
// over from old (read from it), else nil.
func minimapIndex(old *mpq.Archive, files []mpq.File, keep []mpq.Entry) ([]byte, error) {
	for _, f := range files {
		if strings.EqualFold(f.Name, wow.MinimapIndexPath) {
			return f.Data, nil
		}
	}
	for _, f := range keep {
		if strings.EqualFold(f.Name, wow.MinimapIndexPath) {
			return old.ReadFile(f.Name)
		}
	}
	return nil, nil
}

// dropUnusedMinimaps leaves out of the carried-over files the minimap tiles (textures\Minimap\*.blp)
// that the patch's minimap index (minimapIndex) names in no row: a tile drawn again is stored under
// the md5 of its new bytes, and its old file would otherwise stay in the patch (#164). Without an
// index in the patch every file is kept.
func dropUnusedMinimaps(keep []mpq.Entry, index []byte) []mpq.Entry {
	if index == nil {
		return keep
	}
	named := map[string]bool{}
	wow.ParseMinimapIndex(index).Each(func(_, file string) { named[strings.ToUpper(file)] = true })
	const dir = `TEXTURES\MINIMAP\`
	out := keep[:0]
	for _, f := range keep {
		name := strings.ToUpper(strings.ReplaceAll(f.Name, "/", `\`))
		if rest, ok := strings.CutPrefix(name, dir); ok && !strings.Contains(rest, `\`) && strings.HasSuffix(rest, ".BLP") && !named[rest] {
			continue
		}
		out = append(out, f)
	}
	return out
}

// archiveOwner returns the marker of an archive Meld or Ironforge wrote, or "" for any other.
func archiveOwner(path string) (string, error) {
	a, err := mpq.Open(path)
	if err != nil {
		return "", err
	}
	defer a.Close()
	return archiveOwnerOf(a), nil
}

// archiveOwnerOf is archiveOwner of an archive already open.
func archiveOwnerOf(a *mpq.Archive) string {
	switch {
	case a.Has(mpq.MarkerName), a.Has(mpq.OldMarkerName):
		return mpq.MarkerName
	case a.Has(IronforgeMarker):
		return IronforgeMarker
	}
	return ""
}

// backup copies src to dst unless dst exists already, so the first backup is kept. The copy is synced
// to disk before src is replaced, and a copy that failed is removed, since an existing dst is never
// written again (#638).
func backup(src, dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(dst)
	}
	return err
}

// ChangedFiles keeps the files whose bytes differ from the copy in the patch in dataDir, so an export
// writes only what changed since the last one. Without a patch Meld or Ironforge wrote, every file
// counts as changed (InstallPatch then decides what to do with that patch).
func ChangedFiles(dataDir string, files []mpq.File) ([]mpq.File, error) {
	target := filepath.Join(dataDir, PatchName)
	if _, err := os.Stat(target); err != nil {
		return files, nil
	}
	// Opened once, for its owner and its files both (#476). An archive that doesn't open is no patch
	// Meld wrote, and InstallPatch reports it.
	a, err := mpq.Open(target)
	if err != nil {
		return files, nil
	}
	defer a.Close()
	if archiveOwnerOf(a) == "" {
		return files, nil
	}
	var out []mpq.File
	for _, f := range files {
		// A file of another size changed, without reading the old copy.
		if size, ok := a.Size(f.Name); !ok || size != int64(len(f.Data)) {
			out = append(out, f)
			continue
		}
		have, err := a.ReadFile(f.Name)
		if err != nil || !bytes.Equal(have, f.Data) {
			out = append(out, f)
		}
	}
	return out, nil
}

// countTiles is how many of the files are map tiles.
func countTiles(files []mpq.File) int {
	n := 0
	for _, f := range files {
		if strings.EqualFold(filepath.Ext(f.Name), ".adt") {
			n++
		}
	}
	return n
}
