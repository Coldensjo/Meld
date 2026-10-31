package main

import (
	"errors"
	"fmt"
	"strings"

	"Meld/internal/blender"
	"Meld/internal/config"
)

// Open in Blender (#290): a placed client model exported as glTF into a work folder of its own and
// opened in Blender, the folder's .blend opened instead once the user has saved one.

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

// OpenInBlender opens a placed client model (its object type, "m2:<path>" or "wmo:<path>" with any look
// or doodad set after '?') in Blender: exported as glTF into its work folder and imported there by a
// script, or, once the user has saved a .blend there, that file as it is.
func (a *App) OpenInBlender(objType string) (BlenderOpened, error) {
	kind, path, _ := strings.Cut(objType, ":")
	if (kind != "m2" && kind != "wmo") || path == "" {
		return BlenderOpened{}, errors.New("only the client's models open in Blender")
	}
	if strings.HasPrefix(path, "@") {
		return BlenderOpened{}, errors.New("a model of another client doesn't open in Blender yet")
	}
	info := a.Blender()
	if info.Program == "" {
		return BlenderOpened{}, errors.New(info.Error)
	}
	root, err := blender.Root()
	if err != nil {
		return BlenderOpened{}, err
	}
	name := path
	if q := strings.IndexByte(name, '?'); q >= 0 {
		name = name[:q]
	}
	name = name[strings.LastIndexAny(name, `\/`)+1:]
	if dot := strings.LastIndexByte(name, '.'); dot > 0 {
		name = name[:dot]
	}
	w := blender.WorkFor(root, name, objType)
	fresh, err := blender.Open(info.Program, w, func() ([]byte, error) { return a.wow.ModelGLB(path) })
	if err != nil {
		return BlenderOpened{}, err
	}
	return BlenderOpened{Folder: w.Dir, Fresh: fresh}, nil
}
