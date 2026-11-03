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
	"time"

	"Meld/internal/mpq"
)

// Client files waiting for the game to close (#365). On Windows the running game holds Meld's patch
// open, so a save that only adds rows to the client's tables (the spell editor's Spell.dbc,
// SpellIcon.dbc and visual tables) doesn't close the game: its files wait in the user's cache, one
// folder a client data folder, and are written into the patch once the game has closed. Meld's own
// reads of those tables see the waiting files first (readOverlay), so the next save builds on them and
// the editors show what was saved.
//
// A file leaving the patch waits the same way (#925): the Icons tool's Delete and the Sound tool's
// Restore and Delete of a file the patch has keep a removal under the file's name (dropMark instead of
// the data), and the next patch write leaves the file out. Meld's reads see the file gone at once
// (readOverlay and PendingOverlay read the archives other than Meld's patch). A removal and a waiting
// file share the name's slot, so whichever came last stands: an icon deleted and then imported again
// under its name is written, not removed.

// pendingMu guards the waiting files within this process. The calls that change them (AddPending,
// ClearPending, DropPendingFiles, ...) hold the patch's lock file first (lockClient, #1079), so
// meldtool's writes and the app's never write and clear the same slot at once.
var pendingMu sync.Mutex

// pendingSet is what waits in each client data folder's folder of waiting files: each file's name
// (pendingName) with its size and modification time, so the asset server's icon previews don't list
// the folder for a name nothing waits under (#485). Another process (meldtool's record writes,
// #1055) changes the folders too, so a lookup stats the folder and lists it again when its
// modification time moved, which every create, rename and removal of an entry does (#1080). A change
// the listing finds that this process didn't make bumps gen and has Meld's reader forget the files,
// so what was decoded from the old waiting files is read again. It starts over when pendingRoot
// changes (the tests). Guarded by pendingMu.
var pendingSet struct {
	root string
	// rootMod is the root's modification time when its folders were last listed, zero to list them
	// again.
	rootMod time.Time
	dirs    map[string]*pendingFolder
	// gen counts the changes found on disk (pendingGeneration).
	gen uint64
}

// pendingFolder is a client data folder's waiting files as last listed.
type pendingFolder struct {
	// mod is the folder's modification time at the listing, zero to list it again at the next lookup.
	mod   time.Time
	names map[string]pendingStamp
}

// pendingStamp tells one stored entry from the next one saved under its name.
type pendingStamp struct {
	size int64
	mod  time.Time
}

// pendingRacy is how long after a modification time a listing is not trusted: a file system that
// keeps times coarser than the gap between two writes (FAT's two seconds, a clock tick) leaves a
// folder's time unchanged by the second, so a folder changed this recently is listed again at every
// lookup until its time is older, as git does with its index. A variable for the tests.
var pendingRacy = 2 * time.Second

// pendingNames is the waiting files of dir, synced with the disk. The caller holds pendingMu.
func pendingNames(dir string) map[string]pendingStamp {
	return syncPendingDir(dir).names
}

// startPending empties pendingSet when it is new or pendingRoot moved. The caller holds pendingMu.
func startPending() {
	root := pendingRoot()
	if pendingSet.dirs != nil && pendingSet.root == root {
		return
	}
	pendingSet.root, pendingSet.rootMod, pendingSet.dirs = root, time.Time{}, map[string]*pendingFolder{}
}

// syncPendingDir lists dir again when its modification time moved since the last listing, and
// returns what waits in it. The caller holds pendingMu.
func syncPendingDir(dir string) *pendingFolder {
	startPending()
	f := pendingSet.dirs[dir]
	if f != nil && !f.mod.IsZero() {
		if st, err := os.Stat(dir); err == nil && st.ModTime().Equal(f.mod) {
			return f
		}
	}
	return listPendingDir(dir, true)
}

// notePendingDir lists dir again after this process changed it, as syncPendingDir would but without
// counting the change as one from outside: the caller already had Meld's reader forget its files.
// The caller holds pendingMu and lockClient, so no other process changed dir since its own
// syncPendingDir.
func notePendingDir(dir string) {
	startPending()
	listPendingDir(dir, false)
}

// listPendingDir lists dir into pendingSet. With outside set, entries that came, went or changed
// since the last listing bump gen and are forgotten by Meld's reader. The caller holds pendingMu.
func listPendingDir(dir string, outside bool) *pendingFolder {
	old := pendingSet.dirs[dir]
	f := &pendingFolder{names: map[string]pendingStamp{}}
	if st, err := os.Stat(dir); err == nil {
		if time.Since(st.ModTime()) >= pendingRacy {
			f.mod = st.ModTime()
		}
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			f.names[e.Name()] = pendingStamp{size: info.Size(), mod: info.ModTime()}
			if time.Since(info.ModTime()) < pendingRacy {
				f.mod = time.Time{}
			}
		}
	}
	pendingSet.dirs[dir] = f
	if outside {
		var changed []string
		if old != nil {
			for key, was := range old.names {
				if now, ok := f.names[key]; !ok || now.size != was.size || !now.mod.Equal(was.mod) {
					changed = append(changed, key)
				}
			}
		}
		for key := range f.names {
			if old == nil || !hasPendingKey(old.names, key) {
				changed = append(changed, key)
			}
		}
		if len(changed) > 0 {
			pendingChanged(changed)
		}
	}
	return f
}

func hasPendingKey(names map[string]pendingStamp, key string) bool {
	_, ok := names[key]
	return ok
}

// pendingChanged notes waiting entries (by pendingName) that changed on disk without this process:
// gen moves on, so the decoded spell tables are read again (loadSpellData), and Meld's reader forgets
// what it decoded from them. The caller holds pendingMu.
func pendingChanged(keys []string) {
	pendingSet.gen++
	r := heldReader()
	if r == nil {
		return
	}
	names := make([]string, 0, len(keys))
	for _, key := range keys {
		if b, err := base64.RawURLEncoding.DecodeString(key); err == nil {
			names = append(names, string(b))
		}
	}
	r.Forget(names...)
}

// pendingGeneration syncs dataDir's waiting files with the disk and returns how many changes to the
// waiting files have been found there so far: a cache built from them is stale once it moves.
func pendingGeneration(dataDir string) uint64 {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	syncPendingDir(pendingDir(dataDir))
	return pendingSet.gen
}

// AnyPending says whether any file waits for any client data folder: a stat of the folder of waiting
// files and of each client's folder, listing only those whose modification time moved.
func AnyPending() bool {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	startPending()
	root := pendingSet.root
	st, err := os.Stat(root)
	if err == nil && (pendingSet.rootMod.IsZero() || !st.ModTime().Equal(pendingSet.rootMod)) {
		pendingSet.rootMod = time.Time{}
		if time.Since(st.ModTime()) >= pendingRacy {
			pendingSet.rootMod = st.ModTime()
		}
		subs, _ := os.ReadDir(root)
		for _, sub := range subs {
			if dir := filepath.Join(root, sub.Name()); sub.IsDir() && pendingSet.dirs[dir] == nil {
				listPendingDir(dir, true)
			}
		}
	}
	found := false
	for dir := range pendingSet.dirs {
		if len(syncPendingDir(dir).names) > 0 {
			found = true
		}
	}
	return found
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

// A waiting file is stored as its archive path, a 0 byte and its data; a waiting removal (#925) as the
// path and dropMark, with no 0 byte, so a reader that knows only files skips it.
const dropMark = "\x01"

// parsePending reads a stored entry: the archive path, the data of a waiting file, and whether it is
// a removal instead. ok is false for anything else.
func parsePending(b []byte) (name string, data []byte, drop, ok bool) {
	s := string(b)
	if n, d, found := strings.Cut(s, "\x00"); found {
		return n, []byte(d), false, true
	}
	if n, found := strings.CutSuffix(s, dropMark); found && n != "" {
		return n, nil, true, true
	}
	return "", nil, false, false
}

// writePending stores an entry in its name's slot, through a temporary file renamed over it. The
// caller holds pendingMu and lists dir again after (notePendingDir).
func writePending(dir, name string, entry []byte) error {
	tmp := filepath.Join(dir, pendingName(name)+".tmp")
	if err := writeSynced(tmp, entry); err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(dir, pendingName(name))); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// AddPending keeps files to be written into the patch once the game has closed, each replacing a
// waiting file of the same name.
func AddPending(dataDir string, files []mpq.File) error {
	unlock, err := lockClient(dataDir)
	if err != nil {
		return err
	}
	defer unlock()
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	syncPendingDir(dir)
	defer notePendingDir(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, f := range files {
		// The archive path first, then the data: the file name holds it lower case only.
		if err := writePending(dir, f.Name, append(append([]byte(f.Name), 0), f.Data...)); err != nil {
			return err
		}
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

// AddPendingDrops keeps the removal of the files named names from Meld's patch until the game has
// closed (#925), each replacing a waiting file of the same name: the next patch write leaves them out.
func AddPendingDrops(dataDir string, names []string) error {
	unlock, err := lockClient(dataDir)
	if err != nil {
		return err
	}
	defer unlock()
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	syncPendingDir(dir)
	defer notePendingDir(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, name := range names {
		if err := writePending(dir, name, []byte(name+dropMark)); err != nil {
			return err
		}
	}
	// Meld's reader now reads them from the client's own archives, or not at all.
	if r := heldReader(); r != nil {
		r.Forget(names...)
	}
	return nil
}

// PendingFiles lists the files waiting for a client data folder, by name. The removals waiting with
// them are PendingDrops.
func PendingFiles(dataDir string) ([]mpq.File, error) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	files, _, err := readPending(dataDir)
	return files, err
}

// PendingDrops lists the files waiting to leave Meld's patch once the game has closed (#925), by name.
func PendingDrops(dataDir string) ([]string, error) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	_, drops, err := readPending(dataDir)
	return drops, err
}

// PendingCount is how many client files wait for the game to close, the removals included: what the
// status bar shows and what the watcher waits on.
func PendingCount(dataDir string) (int, error) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	files, drops, err := readPending(dataDir)
	return len(files) + len(drops), err
}

// readPending reads the waiting files and removals of a client data folder, each sorted by name. The
// caller holds pendingMu.
func readPending(dataDir string) ([]mpq.File, []string, error) {
	entries, err := os.ReadDir(pendingDir(dataDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var files []mpq.File
	var drops []string
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".tmp") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(pendingDir(dataDir), e.Name()))
		if err != nil {
			return nil, nil, err
		}
		name, data, drop, ok := parsePending(b)
		switch {
		case !ok:
		case drop:
			drops = append(drops, name)
		default:
			files = append(files, mpq.File{Name: name, Data: data})
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	sort.Strings(drops)
	return files, drops, nil
}

// DropPending drops every file waiting for a client data folder, unwritten: the probes' throwaway
// client starts each time without what a probe left waiting (#368).
func DropPending(dataDir string) error {
	unlock, err := lockClient(dataDir)
	if err != nil {
		return err
	}
	defer unlock()
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	syncPendingDir(dir)
	defer notePendingDir(dir)
	return os.RemoveAll(dir)
}

// ClearPending drops the waiting files of a client data folder that are the ones in written (by
// name and content), after they went into the patch; a file saved again meanwhile stays.
func ClearPending(dataDir string, written []mpq.File) error {
	unlock, err := lockClient(dataDir)
	if err != nil {
		return err
	}
	defer unlock()
	return clearPending(dataDir, written)
}

// clearPending is ClearPending, for a caller holding lockClient.
func clearPending(dataDir string, written []mpq.File) error {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	syncPendingDir(dir)
	defer notePendingDir(dir)
	for _, f := range written {
		if err := clearEntry(dataDir, f.Name, f.Name+"\x00"+string(f.Data)); err != nil {
			return err
		}
	}
	return nil
}

// clearDrops drops the waiting removals of the files named dropped, after a patch write left them
// out; a name saved or removed again meanwhile stays. The caller holds lockClient.
func clearDrops(dataDir string, dropped []string) error {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	syncPendingDir(dir)
	defer notePendingDir(dir)
	for _, name := range dropped {
		if err := clearEntry(dataDir, name, name+dropMark); err != nil {
			return err
		}
	}
	return nil
}

// clearEntry removes what is stored under name when it is still entry. The caller holds pendingMu
// and lists the folder again after (notePendingDir).
func clearEntry(dataDir, name, entry string) error {
	path := filepath.Join(pendingDir(dataDir), pendingName(name))
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if string(b) != entry {
		return nil
	}
	return os.Remove(path)
}

// pendingEntry is what waits under name: a file's data, or a removal (drop).
func pendingEntry(dataDir, name string) (data []byte, drop, ok bool) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir, key := pendingDir(dataDir), pendingName(name)
	if _, ok := pendingNames(dir)[key]; !ok {
		return nil, false, false
	}
	b, err := os.ReadFile(filepath.Join(dir, key))
	if err != nil {
		return nil, false, false
	}
	_, data, drop, ok = parsePending(b)
	return data, drop, ok
}

// pendingFile is a waiting file's data, when one waits under name.
func pendingFile(dataDir, name string) ([]byte, bool) {
	data, drop, ok := pendingEntry(dataDir, name)
	return data, ok && !drop
}

// readOverlay reads a client file as the game will see it once the waiting files are written: the
// waiting one, else the archives' (Meld's patch included, unless the file waits to leave it).
func readOverlay(set *mpq.Set, dataDir, name string) ([]byte, error) {
	data, drop, ok := pendingEntry(dataDir, name)
	switch {
	case ok && drop:
		return set.ReadFileExcept(name, set.PatchName())
	case ok:
		return data, nil
	}
	return set.ReadFile(name)
}

// PendingOverlay reads a client file for Meld's own reader (the asset server's previews and Play
// buttons) as the game will see it once the waiting files are written, when something waits under its
// name: a waiting file's data, or, for a waiting removal (#925), the client's own copy outside Meld's
// patch, or mpq.ErrNotFound when it has none. ok is false when nothing waits under the name.
func PendingOverlay(dataDir, name string) (data []byte, ok bool, err error) {
	name = strings.ReplaceAll(name, "/", `\`)
	data, drop, ok := pendingEntry(dataDir, name)
	if !ok || !drop {
		return data, ok, nil
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, true, err
	}
	defer set.Close()
	data, err = set.ReadFileExcept(name, set.PatchName())
	return data, true, err
}

// InstallWithPending writes files into the patch with the files waiting for the game to close
// (#365) taken along, then drops the waiting ones it wrote. Reading the waiting files, the write and
// the drop hold patchMu and the patch's lock file together, so no other write can slip between them,
// in this process (#657) or another (#1079). With nothing given and nothing waiting it writes nothing
// and returns "".
func InstallWithPending(dataDir string, files []mpq.File) (string, error) {
	unlock, err := lockPatch(dataDir)
	if err != nil {
		return "", err
	}
	defer unlock()
	return installTakingPending(dataDir, files, nil, false)
}

// installTakingPending writes files into the patch and leaves the files named drop out of it, taking
// the waiting files and removals (#925) along, then clears the waiting ones it wrote. A file given
// stands over a waiting removal of its name: carryOver leaves the patch's copy out, and files has the
// new one. With nothing given or waiting it writes nothing and returns "", unless always is set. The
// caller holds lockPatch.
func installTakingPending(dataDir string, files []mpq.File, drop []string, always bool) (string, error) {
	pendingMu.Lock()
	pending, drops, err := readPending(dataDir)
	pendingMu.Unlock()
	if err != nil {
		return "", err
	}
	if !always && len(pending) == 0 && len(drops) == 0 && len(files) == 0 && len(drop) == 0 {
		return "", nil
	}
	patch, err := installPatch(dataDir, WithPending(pending, files), append(append([]string(nil), drop...), drops...)...)
	if err != nil || len(pending) == 0 && len(drops) == 0 {
		return patch, err
	}
	if err := clearPending(dataDir, pending); err != nil {
		return patch, err
	}
	err = clearDrops(dataDir, drops)
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

// DropPendingFiles drops the files waiting for a client data folder under the given names, unwritten
// (an added icon deleted before the patch had it, #717), and says whether one waited.
func DropPendingFiles(dataDir string, names []string) (bool, error) {
	unlock, err := lockClient(dataDir)
	if err != nil {
		return false, err
	}
	defer unlock()
	return dropPendingFiles(dataDir, names)
}

// dropPendingFiles is DropPendingFiles, for a caller holding lockClient.
func dropPendingFiles(dataDir string, names []string) (bool, error) {
	pendingMu.Lock()
	defer pendingMu.Unlock()
	dir := pendingDir(dataDir)
	syncPendingDir(dir)
	defer notePendingDir(dir)
	dropped := false
	for _, name := range names {
		key := pendingName(name)
		err := os.Remove(filepath.Join(dir, key))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return dropped, err
		}
		dropped = true
	}
	if r := heldReader(); r != nil && dropped {
		r.Forget(names...)
	}
	return dropped, nil
}

// RemovePatchFiles writes Meld's patch again without the files named names, taking the waiting files
// along as InstallWithPending does (one of those names waiting is dropped, unwritten). The game must
// not hold the patch open (Windows); the caller checks that, and while it does, keeps the removal
// waiting instead (AddPendingDrops, #925).
func RemovePatchFiles(dataDir string, names []string) (string, error) {
	return InstallDropping(dataDir, nil, names)
}

// InstallDropping writes files into Meld's patch and leaves the files named drop out of it, in one
// write, taking the waiting files along as InstallWithPending does (one of the dropped names waiting
// is dropped, unwritten): the Sound tool's Delete (#901) drops an imported sound's file and writes the
// tables without its rows together. The game must not hold the patch open, as for RemovePatchFiles.
func InstallDropping(dataDir string, files []mpq.File, drop []string) (string, error) {
	unlock, err := lockPatch(dataDir)
	if err != nil {
		return "", err
	}
	defer unlock()
	if _, err := dropPendingFiles(dataDir, drop); err != nil {
		return "", err
	}
	return installTakingPending(dataDir, files, drop, true)
}

// PatchFileState says where a client file is: in Meld's patch, waiting for the game to close before
// the patch has it, and in the client's own archives (outside Meld's patch). A file in the patch (or
// waiting) that the client has too was replaced, and dropping it from the patch restores the
// client's (#901). A file in the patch that waits to leave it once the game has closed (#925) is
// Leaving, not InPatch.
type PatchFileState struct {
	Path     string `json:"path"`
	InPatch  bool   `json:"inPatch"`
	Waiting  bool   `json:"waiting"`
	Leaving  bool   `json:"leaving"`
	InClient bool   `json:"inClient"`
}

// ReadPatchFileStates is the PatchFileState of each of paths, in their order.
func ReadPatchFileStates(dataDir string, paths []string) ([]PatchFileState, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	var patch *mpq.Archive
	if a, err := mpq.Open(PatchPath(dataDir)); err == nil {
		patch = a
		defer a.Close()
	}
	out := make([]PatchFileState, 0, len(paths))
	for _, p := range paths {
		p = strings.ReplaceAll(p, "/", `\`)
		st := PatchFileState{Path: p}
		_, drop, waits := pendingEntry(dataDir, p)
		st.Waiting = waits && !drop
		st.Leaving = waits && drop && patch != nil && patch.Has(p)
		st.InPatch = !st.Leaving && patch != nil && patch.Has(p)
		_, err := set.ReadFileExcept(p, set.PatchName())
		st.InClient = err == nil
		out = append(out, st)
	}
	return out, nil
}
