package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"Meld/internal/heightmap"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// BrowseBrushImageFolder lets the user pick the folder of greyscale images that shape the image
// brushes (Noggit Red's Samples folder). Returns "" if cancelled.
func (a *App) BrowseBrushImageFolder(current string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select the folder of brush images",
		DefaultDirectory: current,
	})
}

// BrowsePrefabFolder lets the user pick the folder their prefabs are kept in (#170). Returns "" if cancelled.
func (a *App) BrowsePrefabFolder(current string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select the folder for prefabs",
		DefaultDirectory: current,
	})
}

// PrefabFile is one prefab of the prefab folder: its file name and its TOML.
type PrefabFile struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// prefabMaxBytes skips files too big to be a prefab, so a stray file can't stall the list.
const prefabMaxBytes = 1 << 20

// ListPrefabs reads every .toml file of the prefab folder, sorted by name.
func (a *App) ListPrefabs(dir string) ([]PrefabFile, error) {
	if dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []PrefabFile
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".toml") {
			continue
		}
		if info, err := e.Info(); err != nil || info.Size() > prefabMaxBytes {
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, PrefabFile{Name: e.Name(), Text: string(b)})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out, nil
}

// SavePrefabDialog asks where to save a prefab, starting in the prefab folder. Returns "" if cancelled.
func (a *App) SavePrefabDialog(dir, suggested string) (string, error) {
	if suggested == "" {
		suggested = "prefab"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Save Selection as Prefab",
		DefaultDirectory: dir,
		DefaultFilename:  suggested + ".toml",
		Filters:          []runtime.FileFilter{{DisplayName: "Meld prefab (*.toml)", Pattern: "*.toml"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".toml") {
		path += ".toml"
	}
	return path, nil
}

// ListBrushImages names the PNG and JPEG images in the brush image folder.
func (a *App) ListBrushImages(dir string) ([]string, error) {
	return heightmap.ListImages(dir)
}

// ReadBrushImage reads one image of the brush image folder as grey levels, at most 256 pixels a side.
func (a *App) ReadBrushImage(dir, name string) (*heightmap.GreyView, error) {
	if name != filepath.Base(name) {
		return nil, errors.New("not an image of the brush folder")
	}
	g, err := heightmap.ReadGrey(filepath.Join(dir, name), 256)
	if err != nil {
		return nil, err
	}
	return g.View(), nil
}

// SaveSQLDialog asks where to save an SQL file. Returns "" if cancelled.
func (a *App) SaveSQLDialog(suggested string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Spawn SQL",
		DefaultFilename: suggested + ".sql",
		Filters:         []runtime.FileFilter{{DisplayName: "SQL script (*.sql)", Pattern: "*.sql"}},
	})
}

// ReadImageFile returns a PNG file's bytes as base64, for the frontend to decode (a picture to import).
func (a *App) ReadImageFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if !bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) {
		return "", errors.New("not a PNG image")
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// HeightmapData is a square grid of terrain heights read from an image: Side samples a side, row by row.
type HeightmapData struct {
	Side    int       `json:"side"`
	Heights []float32 `json:"heights"`
}

var heightmapFilters = []runtime.FileFilter{{DisplayName: "PNG heightmap (*.png)", Pattern: "*.png"}}

// SaveHeightmapDialog asks where to save a heightmap image. Returns "" if cancelled.
func (a *App) SaveHeightmapDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "heightmap"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Heightmap",
		DefaultFilename: suggested + ".png",
		Filters:         heightmapFilters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".png") {
		path += ".png"
	}
	return path, nil
}

// OpenImageDialog asks for a PNG image to read, under the given dialog title. Returns "" if cancelled.
func (a *App) OpenImageDialog(title string) (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: title, Filters: imageFilters})
}

var referenceFilters = []runtime.FileFilter{{DisplayName: "Image (*.png, *.jpg)", Pattern: "*.png;*.jpg;*.jpeg"}}

// OpenReferenceImageDialog asks for the reference image to lay over the map (View › Reference
// Image, #184). Returns "" if cancelled.
func (a *App) OpenReferenceImageDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Reference Image", Filters: referenceFilters})
}

// referenceMaxBytes skips a file too big to be a reference image, so a stray pick can't stall the bridge.
const referenceMaxBytes = 64 << 20

// ReadReferenceImage returns a PNG or JPEG file's bytes as base64, for the page to decode itself
// (in colour, at its own size); the map keeps only the path.
func (a *App) ReadReferenceImage(path string) (string, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg":
	default:
		return "", errors.New("a reference image is a PNG or JPEG file")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if info.Size() > referenceMaxBytes {
		return "", fmt.Errorf("%s is %d MB, more than a reference image may be (%d MB)", filepath.Base(path), info.Size()>>20, referenceMaxBytes>>20)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// OpenHeightmapDialog asks for a heightmap image to import. Returns "" if cancelled.
func (a *App) OpenHeightmapDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Heightmap",
		Filters: heightmapFilters,
	})
}

// WriteHeightmap saves a grid of heights as a 16-bit PNG at path.
func (a *App) WriteHeightmap(path string, side int, heights []float32) error {
	data, err := heightmap.Encode(side, heights)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// WriteNormalMap saves a normal map: side x side RGB pixels, three bytes each, sent base64-encoded.
func (a *App) WriteNormalMap(path string, side int, rgb string) error {
	raw, err := base64.StdEncoding.DecodeString(rgb)
	if err != nil {
		return err
	}
	data, err := heightmap.EncodeRGB(side, raw)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// ReadHeightmap reads a heightmap image as a grid of heights.
func (a *App) ReadHeightmap(path string) (HeightmapData, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return HeightmapData{}, err
	}
	side, heights, err := heightmap.Decode(data)
	if err != nil {
		return HeightmapData{}, err
	}
	return HeightmapData{Side: side, Heights: heights}, nil
}

var textFilters = []runtime.FileFilter{{DisplayName: "Text file (*.txt)", Pattern: "*.txt"}}

// SaveTextDialog asks where to save a text file. Returns "" if cancelled.
func (a *App) SaveTextDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "list"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Object List",
		DefaultFilename: suggested + ".txt",
		Filters:         textFilters,
	})
}

// OpenTextDialog asks for a text file to import. Returns "" if cancelled.
func (a *App) OpenTextDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Object List",
		Filters: textFilters,
	})
}

var brushFilters = []runtime.FileFilter{{DisplayName: "Doodad brush (*.toml)", Pattern: "*.toml"}}

// SaveBrushDialog asks where to save a doodad brush. Returns "" if cancelled.
func (a *App) SaveBrushDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "brush"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Doodad Brush",
		DefaultFilename: suggested + ".toml",
		Filters:         brushFilters,
	})
}

// OpenBrushDialog asks for doodad brush files to import. Returns none if cancelled.
func (a *App) OpenBrushDialog() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Doodad Brushes",
		Filters: brushFilters,
	})
}

var setFilters = []runtime.FileFilter{{DisplayName: "Model set (*.toml)", Pattern: "*.toml"}}

// SaveModelSetDialog asks where to save a model set. Returns "" if cancelled.
func (a *App) SaveModelSetDialog(suggested string) (string, error) {
	if suggested == "" {
		suggested = "set"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Model Set",
		DefaultFilename: suggested + ".toml",
		Filters:         setFilters,
	})
}

// OpenModelSetDialog asks for model set files to import. Returns none if cancelled.
func (a *App) OpenModelSetDialog() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import Model Sets",
		Filters: setFilters,
	})
}

// WriteTextFile saves text at path.
func (a *App) WriteTextFile(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o644)
}

var imageFilters = []runtime.FileFilter{{DisplayName: "PNG image (*.png)", Pattern: "*.png"}}

// SaveImageDialog asks where to save a PNG image. Returns "" if cancelled.
func (a *App) SaveImageDialog(title, suggested string) (string, error) {
	if suggested == "" {
		suggested = "image"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           title,
		DefaultFilename: suggested + ".png",
		Filters:         imageFilters,
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(path), ".png") {
		path += ".png"
	}
	return path, nil
}

// WritePNG saves a PNG image, given as base64 (a binding, since the asset server must not get
// request bodies), at path. It refuses anything that isn't a PNG.
func (a *App) WritePNG(path, pngBase64 string) error {
	b, err := base64.StdEncoding.DecodeString(pngBase64)
	if err != nil {
		return err
	}
	if !bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")) {
		return errors.New("not a PNG image")
	}
	return os.WriteFile(path, b, 0o644)
}

// ReadTextFile returns the text of the file at path.
func (a *App) ReadTextFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	return string(b), err
}
