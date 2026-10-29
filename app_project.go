package main

import (
	"errors"
	"path/filepath"
	"strings"

	"Meld/internal/config"
	"Meld/internal/wow"
)

// Projects (#48): a project folder, where the user's maps of it go, with the client folder it edits.
// Meld opens straight into a map; a project is needed only to edit a part of Azeroth.

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
	return a.openDirectory(dialogOptions{
		Title:                "Select the project folder",
		DefaultDirectory:     a.projectDir(),
		CanCreateDirectories: true,
	})
}

// ProjectInFolder reads what a folder's project file says (its name and client folder), so picking
// a folder used before fills them in. A folder without one gets its own name and no client.
func (a *App) ProjectInFolder(dir string) (config.Project, error) {
	return config.ReadProjectFolder(dir)
}

// OpenProject opens the client at client and makes dir the open project, named name: the folder
// (made if needed) gets its project file and the project goes to the front of the recent list.
// The client is opened first, so a folder that isn't a client leaves the open project as it was.
func (a *App) OpenProject(name, dir, client string) (wow.Status, error) {
	dir, client, name = strings.TrimSpace(dir), strings.TrimSpace(client), strings.TrimSpace(name)
	if dir == "" {
		return a.wow.Status(), errors.New("choose a project folder")
	}
	if client == "" {
		return a.wow.Status(), errors.New("choose the client folder")
	}
	if name == "" {
		name = filepath.Base(filepath.Clean(dir))
	}
	if err := a.wow.Open(client); err != nil {
		return a.wow.Status(), err
	}
	st := a.wow.Status()
	p := config.Project{Name: name, Path: dir, ClientPath: client}
	if err := config.WriteProjectFolder(p); err != nil {
		return st, err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.WowPath, a.cfg.ProjectPath = client, dir
	a.cfg.Projects = config.TouchProject(a.cfg.Projects, p)
	return st, config.Update(func(c *config.Config) error {
		c.WowPath, c.ProjectPath = client, dir
		c.Projects = config.TouchProject(c.Projects, p)
		return nil
	})
}

// CloseProject leaves the open project; the client stays loaded, and the project stays in the
// recent list.
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

// projectClientChanged keeps the open project's client folder the one Preferences picks: its
// recent entry and its project file. Called under cfgMu with c the config being saved.
func projectClientChanged(c *config.Config, client string) {
	if c.ProjectPath == "" || client == "" {
		return
	}
	p := config.FindProject(c.Projects, c.ProjectPath)
	if p == nil || p.ClientPath == client {
		return
	}
	p.ClientPath = client
	_ = config.WriteProjectFolder(*p)
}
