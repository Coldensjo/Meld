package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"Meld/internal/spritemodel"
)

// SpriteModelOptions are Tools > Sprite to 3D Model's choices (spritemodel.Options).
type SpriteModelOptions struct {
	Projection  string  `json:"projection"`
	Reading     string  `json:"reading"`
	KeepOutline bool    `json:"keepOutline"`
	Scale       float64 `json:"scale"`
	// Centre, when set, is where the thing's axis meets the ground, in sprite pixels: CentreX, CentreY.
	Centre  bool `json:"centre"`
	CentreX int  `json:"centreX"`
	CentreY int  `json:"centreY"`
	// Frame is the row of an outfit sheet to read, from 0.
	Frame int `json:"frame"`
}

// SpriteModel is a sprite made into a model: the sprite, the .glb and the model drawn from its four
// sides as the sprite was (base64 each), and what was made.
type SpriteModel struct {
	Path      string     `json:"path"`
	Name      string     `json:"name"`
	Sprite    string     `json:"sprite"`
	GLB       string     `json:"glb"`
	Sides     string     `json:"sides"`
	Summary   string     `json:"summary"`
	Width     int        `json:"width"`
	Height    int        `json:"height"`
	Voxels    int        `json:"voxels"`
	Extra     int        `json:"extra"`
	Covered   int        `json:"covered"`
	Triangles int        `json:"triangles"`
	Size      [3]float64 `json:"size"`
	Bytes     int        `json:"bytes"`
	// Reading is the reading made (Auto's choice) and Run the way a wall runs; CentreX, CentreY where
	// its axis meets the ground; Scores what each reading tried drew of the sprite.
	Reading string              `json:"reading"`
	Run     string              `json:"run"`
	CentreX int                 `json:"centreX"`
	CentreY int                 `json:"centreY"`
	Scores  []spritemodel.Score `json:"scores"`
	// Frames is how many frames (rows) an outfit sheet holds, 0 for a sprite.
	Frames int `json:"frames"`
}

// SpriteFile is a sprite in a folder, for the dialog's list: its path, name, item id (-1 when its name
// holds none) and size.
type SpriteFile struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	ID     int    `json:"id"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// spriteID finds a sprite's item id in its file name: "1514_item_image.png", "item_1514_.png", "1514.png".
var spriteID = regexp.MustCompile(`\d+`)

// OpenSprite asks for the sprite to make a model of; "" when cancelled.
func (a *App) OpenSprite(dir string) (string, error) {
	if dir == "" {
		dir = a.projectDir()
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "A sprite to make a 3D model of",
		DefaultDirectory: dir,
		Filters:          []runtime.FileFilter{{DisplayName: "Sprites (*.png)", Pattern: "*.png"}},
	})
}

// OpenSpriteFolder asks for a folder of sprites to pick from; "" when cancelled.
func (a *App) OpenSpriteFolder(dir string) (string, error) {
	if dir == "" {
		dir = a.projectDir()
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "A folder of sprites",
		DefaultDirectory: dir,
	})
}

// ListSprites lists the PNGs in dir with their sizes, by item id, then by name.
func (a *App) ListSprites(dir string) ([]SpriteFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := []SpriteFile{}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".png") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		cfg, err := png.DecodeConfig(f)
		f.Close()
		if err != nil {
			continue
		}
		id := -1
		if m := spriteID.FindString(e.Name()); m != "" {
			if n, err := strconv.Atoi(m); err == nil {
				id = n
			}
		}
		out = append(out, SpriteFile{Path: path, Name: e.Name(), ID: id, Width: cfg.Width, Height: cfg.Height})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ID != out[j].ID {
			return out[i].ID < out[j].ID
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// SpriteThumb is the sprite at path, base64, for the list's pictures.
func (a *App) SpriteThumb(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// ConvertSprite makes the 3D model of the sprite at path (internal/spritemodel): the frontend shows it
// and SaveSpriteModel writes it.
func (a *App) ConvertSprite(path string, opt SpriteModelOptions) (*SpriteModel, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	name := spritemodel.SafeName(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	o := spritemodel.Options{
		Projection:  spritemodel.Projection(opt.Projection),
		Reading:     spritemodel.Reading(opt.Reading),
		KeepOutline: opt.KeepOutline,
		Scale:       opt.Scale,
		Frame:       opt.Frame,
	}
	if opt.Centre {
		o.Centre = &image.Point{X: opt.CentreX, Y: opt.CentreY}
	}
	m, err := spritemodel.Convert(name, img, o)
	if err != nil {
		return nil, err
	}
	glb, err := m.GLB()
	if err != nil {
		return nil, err
	}
	var sides bytes.Buffer
	if err := png.Encode(&sides, m.Preview(1)); err != nil {
		return nil, err
	}
	r := m.Report
	return &SpriteModel{
		Path:      path,
		Name:      name,
		Sprite:    base64.StdEncoding.EncodeToString(raw),
		GLB:       base64.StdEncoding.EncodeToString(glb),
		Sides:     base64.StdEncoding.EncodeToString(sides.Bytes()),
		Summary:   r.Summary(),
		Width:     r.Width,
		Height:    r.Height,
		Voxels:    r.Voxels,
		Extra:     r.Extra,
		Covered:   r.Covered,
		Triangles: r.Triangles,
		Size:      r.Size,
		Bytes:     len(glb),
		Reading:   string(r.Reading),
		Run:       r.Run,
		CentreX:   r.Centre.X,
		CentreY:   r.Centre.Y,
		Scores:    r.Scores,
		Frames:    frames(r.Reading, img.Bounds()),
	}, nil
}

// frames is how many frames an outfit sheet read as one holds; 0 for anything else.
func frames(r spritemodel.Reading, b image.Rectangle) int {
	if r != spritemodel.Outfit {
		return 0
	}
	return spritemodel.OutfitFrames(b.Dx(), b.Dy())
}

// SaveSpriteModel asks where to save a model ConvertSprite made (glb, base64) and writes it there; it
// offers the game's assets/models/props/sprites when the editor runs from the repository, where the
// client and the editor's props find their models. It gives the path, "" when cancelled.
func (a *App) SaveSpriteModel(name, glb string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(glb)
	if err != nil {
		return "", err
	}
	dir := a.projectDir()
	if models := gameModelsDir(); models != "" {
		dir = filepath.Join(models, "props", "sprites")
		_ = os.MkdirAll(dir, 0o755)
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save the 3D model",
		DefaultDirectory: dir,
		DefaultFilename:  spritemodel.SafeName(name) + ".glb",
		Filters:          []runtime.FileFilter{{DisplayName: "glTF binary (*.glb)", Pattern: "*.glb"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".glb") {
		path += ".glb"
	}
	return path, os.WriteFile(path, data, 0o644)
}

// gameModelsDir is the repository's assets/models, found above the editor's executable or the working
// folder; "" when neither is in the repository.
func gameModelsDir() string {
	var starts []string
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	for _, start := range starts {
		for dir := start; ; dir = filepath.Dir(dir) {
			p := filepath.Join(dir, "assets", "models")
			if info, err := os.Stat(p); err == nil && info.IsDir() {
				return p
			}
			if filepath.Dir(dir) == dir {
				break
			}
		}
	}
	return ""
}
