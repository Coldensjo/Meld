// Package scripts keeps the user's Lua scripts (#28): one .lua file each in a folder of the user's
// config dir, as Noggit Red keeps its own beside its executable, so a script can be written in the
// editor's Scripts window or dropped in from elsewhere (Noggit Red's own scripts included).
package scripts

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Ext is the extension of a script file.
const Ext = ".lua"

// File is one script: its file name and its text.
type File struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// Dir is the scripts folder, <user config dir>/Meld/scripts, made if it is missing.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "Meld", "scripts")
	return dir, os.MkdirAll(dir, 0o755)
}

// FileName is the file a script named name is kept in: the name with .lua added if it lacks it. It
// refuses a name that is empty or reaches out of the folder (a separator, "..").
func FileName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\:`) || strings.Contains(name, "..") {
		return "", errors.New("a script's name may not be empty or hold / \\ : or ..")
	}
	if !strings.EqualFold(filepath.Ext(name), Ext) {
		name += Ext
	}
	return name, nil
}

// List reads every .lua file of dir, sorted by name without regard to case.
func List(dir string) ([]File, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []File{}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), Ext) {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		out = append(out, File{Name: e.Name(), Text: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// Save writes text as the script named name in dir and returns its file name.
func Save(dir, name, text string) (string, error) {
	file, err := FileName(name)
	if err != nil {
		return "", err
	}
	return file, os.WriteFile(filepath.Join(dir, file), []byte(text), 0o644)
}

// Delete removes the script named name from dir.
func Delete(dir, name string) error {
	file, err := FileName(name)
	if err != nil {
		return err
	}
	return os.Remove(filepath.Join(dir, file))
}
