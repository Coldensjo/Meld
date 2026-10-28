package main

import (
	"encoding/base64"

	"Meld/internal/scripts"
)

// Lua scripts (#28): the Scripts window lists, saves and deletes the .lua files of the scripts folder
// (internal/scripts); the scripts run in the page.

// ScriptsFolder is where the scripts are kept, made if it is missing.
func (a *App) ScriptsFolder() (string, error) {
	return scripts.Dir()
}

// ListScripts reads every script of the scripts folder, sorted by name.
func (a *App) ListScripts() ([]scripts.File, error) {
	dir, err := scripts.Dir()
	if err != nil {
		return nil, err
	}
	return scripts.List(dir)
}

// SaveScript writes a script into the scripts folder and returns its file name.
func (a *App) SaveScript(name, text string) (string, error) {
	dir, err := scripts.Dir()
	if err != nil {
		return "", err
	}
	return scripts.Save(dir, name, text)
}

// DeleteScript removes a script from the scripts folder.
func (a *App) DeleteScript(name string) error {
	dir, err := scripts.Dir()
	if err != nil {
		return err
	}
	return scripts.Delete(dir, name)
}

// ScriptImage is a PNG read for a script's load_png (#29): its size, and where the page fetches its
// RGBA pixels from (a handoff, since a 4096-square image is 64 MB of pixels).
type ScriptImage struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	URL    string `json:"url"`
}

// LoadScriptImage reads a PNG for a script: a path relative to the scripts folder, or a whole one.
func (a *App) LoadScriptImage(path string) (ScriptImage, error) {
	dir, err := scripts.Dir()
	if err != nil {
		return ScriptImage{}, err
	}
	file, err := scripts.ImagePath(dir, path)
	if err != nil {
		return ScriptImage{}, err
	}
	w, h, pix, err := scripts.LoadPNG(file)
	if err != nil {
		return ScriptImage{}, err
	}
	return ScriptImage{Width: w, Height: h, URL: a.handoffs.Put(pix)}, nil
}

// The file functions of a script (#761): a path relative to the scripts folder, or a whole one. Writes
// stay in the scripts folder unless anyFile, the user's preference, which the page passes with each call.

// ReadScriptFile reads a file whole for a script's read_file.
func (a *App) ReadScriptFile(path string) (string, error) {
	dir, err := scripts.Dir()
	if err != nil {
		return "", err
	}
	return scripts.ReadFile(dir, path)
}

// ScriptPathExists tells a script's path_exists whether a file or folder is there.
func (a *App) ScriptPathExists(path string) (bool, error) {
	dir, err := scripts.Dir()
	if err != nil {
		return false, err
	}
	return scripts.Exists(dir, path)
}

// WriteScriptFile writes (or with appendTo adds to the end of) a file for a script's write_file and
// append_file.
func (a *App) WriteScriptFile(path, text string, appendTo, anyFile bool) error {
	dir, err := scripts.Dir()
	if err != nil {
		return err
	}
	return scripts.WriteFile(dir, path, text, appendTo, anyFile)
}

// SaveScriptImage writes a script's image as a PNG for image:save; pix is its RGBA bytes in base64, as a
// binding carries no raw bytes.
func (a *App) SaveScriptImage(path string, width, height int, pix string, anyFile bool) error {
	dir, err := scripts.Dir()
	if err != nil {
		return err
	}
	data, err := base64.StdEncoding.DecodeString(pix)
	if err != nil {
		return err
	}
	return scripts.SavePNG(dir, path, width, height, data, anyFile)
}
