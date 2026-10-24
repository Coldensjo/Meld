package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"Meld/internal/config"
	"Meld/internal/otbm"
)

// TibiaImport is what File > Import Tibia Map made: the world's path ("" when cancelled) and the
// import's summary.
type TibiaImport struct {
	Path    string `json:"path"`
	Summary string `json:"summary"`
}

// ImportTibiaMap asks for an Open Tibia map (.otbm), the items.otb it was made with and where to save
// the cube world, then imports it (internal/otbm, 3dgame #218): the world, and beside it an items.csv
// of what became of every item id. The frontend then opens the world.
func (a *App) ImportTibiaMap() (*TibiaImport, error) {
	mapPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Import Tibia Map",
		DefaultDirectory: a.projectDir(),
		Filters:          []runtime.FileFilter{{DisplayName: "Open Tibia Map (*.otbm)", Pattern: "*.otbm"}},
	})
	if err != nil || mapPath == "" {
		return &TibiaImport{}, err
	}
	itemsDir := filepath.Dir(mapPath)
	if p := a.tibiaItemsPath(); p != "" {
		itemsDir = filepath.Dir(p)
	}
	itemsPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "The items.otb the map was made with (items.xml beside it names the items)",
		DefaultDirectory: itemsDir,
		Filters:          []runtime.FileFilter{{DisplayName: "Item table (*.otb)", Pattern: "*.otb"}},
	})
	if err != nil || itemsPath == "" {
		return &TibiaImport{}, err
	}
	a.setTibiaItemsPath(itemsPath)
	outPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save the imported world",
		DefaultDirectory: filepath.Dir(mapPath),
		DefaultFilename:  strings.TrimSuffix(filepath.Base(mapPath), filepath.Ext(mapPath)) + worldExt,
		Filters:          []runtime.FileFilter{{DisplayName: "Cube World (*.world)", Pattern: "*.world"}},
	})
	if err != nil || outPath == "" {
		return &TibiaImport{}, err
	}
	if !strings.EqualFold(filepath.Ext(outPath), worldExt) {
		outPath += worldExt
	}
	rep, err := otbm.Import(mapPath, itemsPath, outPath)
	if err != nil {
		return nil, err
	}
	return &TibiaImport{Path: outPath, Summary: rep.Summary()}, nil
}

// tibiaItemsPath is the items.otb last chosen for a Tibia map, "" before the first.
func (a *App) tibiaItemsPath() string {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	return a.cfg.TibiaItemsPath
}

// setTibiaItemsPath remembers the items.otb chosen for a Tibia map, in the config.
func (a *App) setTibiaItemsPath(path string) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	a.cfg.TibiaItemsPath = path
	_ = config.Update(func(c *config.Config) error {
		c.TibiaItemsPath = path
		return nil
	})
}

// ItemSpritesResult is what Import Tibia Textures read: each texture's PNG as base64, by texture id,
// the hints (name and colour) of those and of the world's own ids that lacked one, and what was kept and
// left out ("" for cancelled).
type ItemSpritesResult struct {
	Images  map[int]string  `json:"images"`
	Hints   []WorldHintData `json:"hints"`
	Summary string          `json:"summary"`
}

// LoadItemSprites asks for a .zip of Tibia item sprites named by item id (Edit > Textures in This
// World > Import Tibia Textures, 3dgame #224, #227) and reads the ones that can lie on a cube face for
// `textures`, the world's texture ids from an imported map (otbm.TextureBase + item id), and, given the
// map's items.otb, for every ground, floor, wall and border it has, with their names, so they can be
// painted and replaced with though the map does not use them. The frontend puts them in the world.
func (a *App) LoadItemSprites(textures []int) (*ItemSpritesResult, error) {
	src, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Item sprites, named by item id (0102_item_image.png)",
		Filters: []runtime.FileFilter{{DisplayName: "Sprites (*.zip)", Pattern: "*.zip"}},
	})
	if err != nil || src == "" {
		return &ItemSpritesResult{}, err
	}
	// The item table says which items are walls and which way they run, so their faces can be
	// unsheared (3dgame #225): the one last chosen, else asked for.
	itemsPath := a.tibiaItemsPath()
	if _, statErr := os.Stat(itemsPath); itemsPath == "" || statErr != nil {
		itemsPath, err = runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
			Title:            "The items.otb the map was made with, for its walls (Cancel to leave them out)",
			DefaultDirectory: filepath.Dir(src),
			Filters:          []runtime.FileFilter{{DisplayName: "Item table (*.otb)", Pattern: "*.otb"}},
		})
		if err != nil {
			return nil, err
		}
	}
	var table otbm.Items
	if itemsPath != "" {
		if table, err = otbm.LoadItems(itemsPath); err != nil {
			return nil, err
		}
		a.setTibiaItemsPath(itemsPath)
	}
	var items []uint16
	inWorld := map[uint16]bool{}
	for _, t := range textures {
		if t >= otbm.TextureBase && t <= 0xffff {
			items = append(items, uint16(t-otbm.TextureBase))
			inWorld[uint16(t-otbm.TextureBase)] = true
		}
	}
	items = append(items, otbm.TextureItems(table)...)
	sprites, rep, err := otbm.ItemSprites(src, items, table)
	if err != nil {
		return nil, err
	}
	out := &ItemSpritesResult{Images: map[int]string{}}
	added := 0
	for id, data := range sprites {
		out.Images[otbm.TextureBase+int(id)] = base64.StdEncoding.EncodeToString(data)
		if !inWorld[id] {
			added++
		}
	}
	// Names and colours: for every texture with a picture, and the world's ids, so a name the table
	// gives replaces a bare "item n".
	if table != nil {
		named := map[uint16]bool{}
		for id := range sprites {
			named[id] = true
		}
		for id := range inWorld {
			named[id] = true
		}
		for id := range named {
			h := otbm.Hint(id, table)
			out.Hints = append(out.Hints, WorldHintData{ID: int(h.ID), Colour: int(h.Colour), Name: h.Name})
		}
	}
	out.Summary = fmt.Sprintf("%d of the world's %d item textures have a sprite there; %d were used (%d of them walls, unsheared to their face, and %d borders), %d standing up (trees, monsters, objects) and %d not one tile keep their colour.",
		rep.Found, rep.Asked, rep.Kept, rep.Walls, rep.Borders, rep.SeeThrough, rep.NotSquare)
	if table == nil {
		out.Summary += " Without items.otb the walls were left out."
	} else {
		out.Summary += fmt.Sprintf(" %d of them are textures the map does not use yet, to paint with.", added)
	}
	return out, nil
}
