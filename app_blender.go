package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"Meld/internal/blender"
	"Meld/internal/config"
	"Meld/internal/wow"
)

// Open in Blender (#290): a placed client model exported as glTF into a work folder of its own and
// opened in Blender, the folder's .blend opened instead once the user has saved one. Import from
// Blender brings the saved model back as a still M2 written into the client's patch, and Import 3D
// Model does the same for a .blend or GLB file made from scratch.

// BlenderInfo is the Blender Open in Blender starts.
type BlenderInfo struct {
	// Path is the folder chosen in the preferences, "" for none.
	Path string `json:"path"`
	// Program is the Blender program found (in Path, beside the client's folder or on the PATH), "" for none.
	Program string `json:"program"`
	// Error says why none was found.
	Error string `json:"error"`
}

// Blender says which Blender Open in Blender starts.
func (a *App) Blender() BlenderInfo {
	a.cfgMu.Lock()
	dir, wowPath := a.cfg.BlenderPath, a.cfg.WowPath
	a.cfgMu.Unlock()
	info := BlenderInfo{Path: dir}
	p, err := blender.Find(dir, wowPath)
	if err != nil {
		info.Error = err.Error()
	}
	info.Program = p
	return info
}

// BrowseBlenderFolder lets the user pick Blender's folder. Returns "" if cancelled.
func (a *App) BrowseBlenderFolder() (string, error) {
	a.cfgMu.Lock()
	dir := a.cfg.BlenderPath
	a.cfgMu.Unlock()
	return a.openDirectory(dialogOptions{Title: "Select the Blender folder", DefaultDirectory: dir})
}

// SetBlenderPath saves Blender's folder, which must hold its program; "" goes back to looking beside
// the client's folder and on the PATH.
func (a *App) SetBlenderPath(path string) error {
	if path != "" && blender.InFolder(path) == "" {
		return fmt.Errorf("%s holds no Blender program", path)
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.BlenderPath = path
	return config.Update(func(c *config.Config) error {
		c.BlenderPath = path
		return nil
	})
}

// BlenderOpened is what Open in Blender did.
type BlenderOpened struct {
	// Folder is the model's work folder, which holds its export and the .blend.
	Folder string `json:"folder"`
	// Fresh says the model was exported and imported anew; false when its saved .blend was opened.
	Fresh bool `json:"fresh"`
}

// modelPath checks a placed object's type for Open in Blender and Import from Blender: a model of the
// client's own, its path after the kind.
func modelPath(objType string) (string, error) {
	kind, path, _ := strings.Cut(objType, ":")
	if (kind != "m2" && kind != "wmo") || path == "" {
		return "", errors.New("only the client's models open in Blender")
	}
	if strings.HasPrefix(path, "@") {
		return "", errors.New("a model of another client doesn't open in Blender yet")
	}
	return path, nil
}

// blenderProgram is the Blender Open in Blender starts, or why there is none.
func (a *App) blenderProgram() (string, error) {
	info := a.Blender()
	if info.Program == "" {
		return "", errors.New(info.Error)
	}
	return info.Program, nil
}

// OpenInBlender opens a placed client model (its object type, "m2:<path>" or "wmo:<path>" with any look
// or doodad set after '?') in Blender: exported as glTF into its work folder and imported there by a
// script, or, once the user has saved a .blend there, that file as it is. A model Meld wrote from
// Blender opens the .blend (or the file) it came from.
func (a *App) OpenInBlender(objType string) (BlenderOpened, error) {
	path, err := modelPath(objType)
	if err != nil {
		return BlenderOpened{}, err
	}
	exe, err := a.blenderProgram()
	if err != nil {
		return BlenderOpened{}, err
	}
	root, err := a.blenderRoot()
	if err != nil {
		return BlenderOpened{}, err
	}
	w := blender.WorkForType(root, objType)
	fresh, err := blender.Open(exe, w, func() ([]byte, error) {
		// A model imported from a GLB file opens that file.
		if m := w.Model(); strings.EqualFold(filepath.Ext(m), ".glb") {
			return os.ReadFile(m)
		}
		return a.wow.ModelGLB(path)
	})
	if err != nil {
		return BlenderOpened{}, err
	}
	return BlenderOpened{Folder: w.Dir, Fresh: fresh}, nil
}

// BlenderImported is a model brought back from Blender: written into the client as a still M2.
type BlenderImported struct {
	// Type is the placed object type of the new model, "m2:<path>".
	Type string `json:"type"`
	// Triangles and Textures count what it holds.
	Triangles int `json:"triangles"`
	Textures  int `json:"textures"`
	// Replaced are the files of an earlier import written over, for the page to load again.
	Replaced []string `json:"replaced"`
	// Waiting says the files wait for the game to close before the patch has them; Meld reads them
	// meanwhile.
	Waiting bool `json:"waiting"`
}

// ImportFromBlender brings back the model a placed object opened in Blender (its type, as
// OpenInBlender takes it): its saved .blend, exported by a background Blender as a GLB, written into
// the client's patch as a still M2 with its textures as BLPs and a collision box, under
// World\Meld\<work folder> (never over a client file), at once or once the game has closed. The page
// then swaps the placement for it.
func (a *App) ImportFromBlender(objType string) (BlenderImported, error) {
	if _, err := modelPath(objType); err != nil {
		return BlenderImported{}, err
	}
	root, err := a.blenderRoot()
	if err != nil {
		return BlenderImported{}, err
	}
	w := blender.WorkForType(root, objType)
	if w.Model() == "" {
		return BlenderImported{}, errors.New("nothing to bring back yet: Open in Blender first, then save your edits there (Ctrl+S)")
	}
	return a.importWork(w)
}

// modelFileFilters are the files Import 3D Model takes.
var modelFileFilters = []fileFilter{{DisplayName: "Blender or glTF model (*.blend, *.glb)", Pattern: "*.blend;*.glb"}}

// BrowseModelFile lets the user pick a model made in Blender (a .blend, or a GLB). Returns "" if cancelled.
func (a *App) BrowseModelFile() (string, error) {
	return a.openFile(dialogOptions{Title: "Import 3D Model", Filters: modelFileFilters})
}

// ImportModelFile writes the model in file (a .blend, exported by a background Blender, or a GLB) into
// the client as ImportFromBlender does, under a work folder of its own that remembers the file, so
// Open in Blender on the new model opens it and Import from Blender reads it again.
func (a *App) ImportModelFile(file string) (BlenderImported, error) {
	ext := strings.ToLower(filepath.Ext(file))
	if ext != ".blend" && ext != ".glb" {
		return BlenderImported{}, errors.New("choose a .blend or .glb file")
	}
	if st, err := os.Stat(file); err != nil || st.IsDir() {
		return BlenderImported{}, fmt.Errorf("%s can't be read", file)
	}
	root, err := a.blenderRoot()
	if err != nil {
		return BlenderImported{}, err
	}
	w := blender.WorkForFile(root, file)
	if err := w.SetSource(file); err != nil {
		return BlenderImported{}, err
	}
	return a.importWork(w)
}

// importWork writes the model of work folder w into the client.
func (a *App) importWork(w blender.Work) (BlenderImported, error) {
	if !a.wow.Status().Loaded {
		return BlenderImported{}, errors.New("the client isn't loaded")
	}
	dataDir, err := a.clientDataDir()
	if err != nil {
		return BlenderImported{}, err
	}
	model := w.Model()
	var glb []byte
	if strings.EqualFold(filepath.Ext(model), ".blend") {
		exe, err := a.blenderProgram()
		if err != nil {
			return BlenderImported{}, err
		}
		ctx := a.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if glb, err = blender.ExportGLB(ctx, exe, model); err != nil {
			return BlenderImported{}, err
		}
	} else if glb, err = os.ReadFile(model); err != nil {
		return BlenderImported{}, err
	}
	client := w.Client()
	built, err := wow.BuildM2FromGLB(glb, client[:strings.LastIndexByte(client, '\\')], w.Name())
	if err != nil {
		return BlenderImported{}, err
	}
	res := BlenderImported{Type: "m2:" + built.Path, Triangles: built.Triangles, Textures: built.Textures, Replaced: []string{}}
	for _, f := range built.Files {
		if _, err := a.wow.ReadFile(f.Name); err == nil {
			res.Replaced = append(res.Replaced, f.Name)
		}
	}
	if _, res.Waiting, err = a.queueClientFiles(dataDir, built.Files); err != nil {
		return BlenderImported{}, err
	}
	return res, nil
}

// blenderRoot is the folder of the models' work folders: blender.Root, or while the probes' throwaway
// client is on, a folder beside it, so a probe leaves nothing in the user's own.
func (a *App) blenderRoot() (string, error) {
	if a.sandboxed() {
		dir, err := sandboxRoot()
		if err != nil {
			return "", err
		}
		return filepath.Join(dir, "blender"), nil
	}
	return blender.Root()
}
