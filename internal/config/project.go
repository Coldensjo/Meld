package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Project is a project folder, where the user's maps of it are kept, with the client folder it edits
// (#48, Noggit Red's project). Editing a part of Azeroth needs one; a new world of its own does not.
type Project struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	ClientPath string `json:"clientPath"`
}

// ProjectFileName is the file in a project folder that holds its name and client folder, so the
// folder opened again from anywhere (another machine's recent list, a moved folder) finds its client.
const ProjectFileName = "meld-project.json"

// MaxRecentProjects is how many projects the recent list keeps.
const MaxRecentProjects = 10

// SamePath tells whether a and b name the same folder: compared cleaned, and without case on Windows.
func SamePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// TouchProject puts p at the front of the recent list, dropping an older entry for its folder and
// the entries past MaxRecentProjects.
func TouchProject(list []Project, p Project) []Project {
	out := []Project{p}
	for _, q := range list {
		if !SamePath(q.Path, p.Path) && len(out) < MaxRecentProjects {
			out = append(out, q)
		}
	}
	return out
}

// ForgetProject drops the project in folder dir from the recent list.
func ForgetProject(list []Project, dir string) []Project {
	out := make([]Project, 0, len(list))
	for _, q := range list {
		if !SamePath(q.Path, dir) {
			out = append(out, q)
		}
	}
	return out
}

// FindProject returns the recent list's entry for folder dir, or nil.
func FindProject(list []Project, dir string) *Project {
	for i := range list {
		if SamePath(list[i].Path, dir) {
			return &list[i]
		}
	}
	return nil
}

// projectFile is what a project folder's file holds; its folder is where the file is.
type projectFile struct {
	Name       string `json:"name"`
	ClientPath string `json:"clientPath"`
}

// ReadProjectFolder reads the project file in dir. A folder without one is a project of the
// folder's name with no client yet (os.ErrNotExist is not an error here).
func ReadProjectFolder(dir string) (Project, error) {
	p := Project{Name: filepath.Base(filepath.Clean(dir)), Path: dir}
	b, err := os.ReadFile(filepath.Join(dir, ProjectFileName))
	if errors.Is(err, os.ErrNotExist) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	var f projectFile
	if err := json.Unmarshal(b, &f); err != nil {
		return p, err
	}
	if f.Name != "" {
		p.Name = f.Name
	}
	p.ClientPath = f.ClientPath
	return p, nil
}

// WriteProjectFolder makes the project's folder if needed and writes its project file.
func WriteProjectFolder(p Project) error {
	if p.Path == "" {
		return errors.New("a project needs a folder")
	}
	if err := os.MkdirAll(p.Path, 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(projectFile{Name: p.Name, ClientPath: p.ClientPath}, "", "\t")
	return os.WriteFile(filepath.Join(p.Path, ProjectFileName), b, 0o644)
}
