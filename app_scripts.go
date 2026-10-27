package main

import "Meld/internal/scripts"

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
