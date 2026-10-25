package main

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"Meld/internal/mapfile"
	"Meld/internal/recovery"
	"Meld/internal/sessionlog"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var mapFilters = []runtime.FileFilter{{DisplayName: "Meld Map (*.wmap)", Pattern: "*.wmap"}}

// SaveMapDialog asks for a destination path. Returns "" if cancelled.
func (a *App) SaveMapDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "untitled"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save Map",
		DefaultDirectory: a.projectDir(),
		DefaultFilename:  suggested + ".wmap",
		Filters:          mapFilters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".wmap") {
		path += ".wmap"
	}
	return path, nil
}

// OpenMapDialog asks for a map to open. Returns "" if cancelled.
func (a *App) OpenMapDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Open Map",
		DefaultDirectory: a.projectDir(),
		Filters:          mapFilters,
	})
}

// SaveMap writes the map to path.
func (a *App) SaveMap(path string, data mapfile.MapData) error {
	if err := mapfile.Save(path, &data); err != nil {
		return err
	}
	runtime.WindowSetTitle(a.ctx, "Meld — "+filepath.Base(path))
	return nil
}

// LoadMap reads the map at path.
func (a *App) LoadMap(path string) (*mapfile.MapData, error) {
	m, err := mapfile.Load(path)
	if err != nil {
		return nil, err
	}
	runtime.WindowSetTitle(a.ctx, "Meld — "+filepath.Base(path))
	return m, nil
}

// startRecovery opens the recovery folder and keeps this session marked as running while it runs.
func (a *App) startRecovery() {
	base, err := os.UserCacheDir()
	if err != nil {
		return
	}
	rec, err := recovery.Open(filepath.Join(base, "Meld", "recovery"))
	if err != nil {
		return
	}
	a.rec = rec
	_ = rec.Touch()
	go func() {
		t := time.NewTicker(recovery.Heartbeat)
		defer t.Stop()
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-t.C:
				_ = rec.Touch()
			}
		}
	}()
}

// startSessionLog opens this session's log file in the user cache (#319).
func (a *App) startSessionLog() {
	base, err := os.UserCacheDir()
	if err != nil {
		return
	}
	if l, err := sessionlog.Open(filepath.Join(base, "Meld", "logs")); err == nil {
		a.slog = l
	}
}

// AppendLog adds the Log window's new lines to the session's log file, which outlives Meld.
func (a *App) AppendLog(lines []string) error {
	if a.slog == nil {
		return nil
	}
	return a.slog.Append(lines)
}

// SessionLog gives what the session's log file holds so far.
func (a *App) SessionLog() (string, error) {
	if a.slog == nil {
		return "", errors.New("no log folder")
	}
	return a.slog.Read()
}

var errNoRecovery = errors.New("no recovery folder")

// SaveRecovery writes the autosaved copy of open map doc (a tab's id) and returns its info. Its
// large fields may come before it through SaveRecoveryPart, empty in data.
func (a *App) SaveRecovery(doc int, info recovery.Info, data mapfile.MapData) (recovery.Info, error) {
	if a.rec == nil {
		return info, errNoRecovery
	}
	return a.rec.Save(doc, info, &data)
}

// SaveRecoveryPart sends the next slice of a large field of doc's autosaved copy ("heights",
// "weights" or "chunkSlots", base64), index 0 first; the SaveRecovery after them writes the copy
// with them. A region's copy is ~100 MB of base64, which crossed the bridge in one call before (#637).
func (a *App) SaveRecoveryPart(doc int, field string, index int, part string) error {
	if a.rec == nil {
		return errNoRecovery
	}
	return a.rec.AddPart(doc, field, index, part)
}

// DropRecoveryParts forgets the parts sent for doc's copy, which the autosave gave up.
func (a *App) DropRecoveryParts(doc int) {
	if a.rec != nil {
		a.rec.DropParts(doc)
	}
}

// DropRecovery removes an autosaved copy: its map was saved, closed or recovered, or the author
// discarded it.
func (a *App) DropRecovery(id string) error {
	if a.rec == nil {
		return errNoRecovery
	}
	return a.rec.Drop(id)
}

// ListRecovery names the autosaved copies that earlier sessions left behind without quitting cleanly.
func (a *App) ListRecovery() ([]recovery.Info, error) {
	if a.rec == nil {
		return nil, nil
	}
	return a.rec.List()
}

// LoadRecovery reads an autosaved copy's map. Unlike LoadMap it leaves the window title alone.
func (a *App) LoadRecovery(id string) (*mapfile.MapData, error) {
	if a.rec == nil {
		return nil, errNoRecovery
	}
	return a.rec.Load(id)
}

// EndRecovery drops this session's copies: the author quit, having saved or discarded every map.
func (a *App) EndRecovery() error {
	if a.rec == nil {
		return nil
	}
	return a.rec.DropSession()
}

// sceneKeep is how many scene map copies SaveSceneMap keeps; older ones are removed.
const sceneKeep = 20

// SaveSceneMap writes a copy of the open map for a copied scene (Help > Copy Scene) into the
// user's cache dir and returns its path. Unlike SaveMap it leaves the window title alone.
func (a *App) SaveSceneMap(data mapfile.MapData) (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Meld", "scenes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "scene-"+time.Now().Format("20060102-150405.000")+".wmap")
	if err := mapfile.Save(path, &data); err != nil {
		return "", err
	}
	// The names sort by time, so the oldest come first.
	if old, err := filepath.Glob(filepath.Join(dir, "scene-*.wmap")); err == nil && len(old) > sceneKeep {
		sort.Strings(old)
		for _, f := range old[:len(old)-sceneKeep] {
			_ = os.Remove(f)
		}
	}
	return path, nil
}
