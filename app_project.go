package main

import (
	"errors"
	"path/filepath"
	"strings"

	"Meld/internal/config"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Projects (#48): a project folder, where the user's worlds go, which the Open and Save dialogs start
// in. Meld opens straight into a world; a project is never needed.

// ProjectList is the open project (nil for none) and the recent ones, newest first.
type ProjectList struct {
	Current *config.Project  `json:"current"`
	Recent  []config.Project `json:"recent"`
}

// Projects reports the open project and the recent list.
func (a *App) Projects() ProjectList {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.projectListLocked()
}

func (a *App) projectListLocked() ProjectList {
	l := ProjectList{Recent: append([]config.Project{}, a.cfg.Projects...)}
	if a.cfg.ProjectPath != "" {
		if p := config.FindProject(a.cfg.Projects, a.cfg.ProjectPath); p != nil {
			c := *p
			l.Current = &c
		}
	}
	return l
}

// projectDir is the open project's folder, or "" for none: the folder the map dialogs start in.
func (a *App) projectDir() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.cfg.ProjectPath
}

// BrowseProjectFolder lets the user pick (or make) a project folder. Returns "" if cancelled.
func (a *App) BrowseProjectFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Select the project folder",
		DefaultDirectory:     a.projectDir(),
		CanCreateDirectories: true,
	})
}

// ProjectInFolder reads what a folder's project file says (its name), so picking a folder used
// before fills it in. A folder without one gets its own name.
func (a *App) ProjectInFolder(dir string) (config.Project, error) {
	return config.ReadProjectFolder(dir)
}

// OpenProject makes dir the open project, named name: the folder (made if needed) gets its project
// file and the project goes to the front of the recent list.
func (a *App) OpenProject(name, dir string) error {
	dir, name = strings.TrimSpace(dir), strings.TrimSpace(name)
	if dir == "" {
		return errors.New("choose a project folder")
	}
	if name == "" {
		name = filepath.Base(filepath.Clean(dir))
	}
	p := config.Project{Name: name, Path: dir}
	if err := config.WriteProjectFolder(p); err != nil {
		return err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.ProjectPath = dir
	a.cfg.Projects = config.TouchProject(a.cfg.Projects, p)
	return config.Update(func(c *config.Config) error {
		c.ProjectPath = dir
		c.Projects = config.TouchProject(c.Projects, p)
		return nil
	})
}

// CloseProject leaves the open project; it stays in the recent list.
func (a *App) CloseProject() error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.ProjectPath = ""
	return config.Update(func(c *config.Config) error {
		c.ProjectPath = ""
		return nil
	})
}

// ForgetProject drops a project from the recent list (its folder and files stay); forgetting the
// open one closes it.
func (a *App) ForgetProject(dir string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	forget := func(c *config.Config) {
		c.Projects = config.ForgetProject(c.Projects, dir)
		if c.ProjectPath != "" && config.SamePath(c.ProjectPath, dir) {
			c.ProjectPath = ""
		}
	}
	forget(&a.cfg)
	return config.Update(func(c *config.Config) error {
		forget(c)
		return nil
	})
}
