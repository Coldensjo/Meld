package wow

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// The client's minimap: one 256x256 BLP per tile under textures\Minimap, named by hash, with
// textures\Minimap\md5translate.trs mapping "<Map>\map<x>_<y>.blp" to the hashed file. The editor
// stitches a whole map into one overview image so a region can be picked by eye.

// MapTile is a tile of a map that has a minimap image, and so exists.
type MapTile struct {
	X, Y int
	File string
}

// OverviewTilePx is the size of one tile in an overview image.
const OverviewTilePx = 32

// MapTilesPerSide is the number of tiles a side of a client map.
const MapTilesPerSide = 64

var minimapLine = regexp.MustCompile(`(?i)^(.+?)\\map(\d+)_(\d+)\.blp$`)

// MinimapTiles lists the tiles of mapName (its folder name, e.g. "Azeroth") that have a minimap
// image. The list is read from md5translate.trs once per client.
func (c *Client) MinimapTiles(mapName string) ([]MapTile, error) {
	table, err := c.minimapTable()
	if err != nil {
		return nil, err
	}
	tiles := table[strings.ToLower(mapName)]
	if tiles == nil {
		return []MapTile{}, nil
	}
	return tiles, nil
}

// minimapTable parses md5translate.trs into tiles by lower-case map name.
func (c *Client) minimapTable() (map[string][]MapTile, error) {
	c.minimapMu.Lock()
	defer c.minimapMu.Unlock()
	if c.minimap != nil {
		return c.minimap, nil
	}
	raw, err := c.read(MinimapIndexPath)
	if err != nil {
		return nil, fmt.Errorf("minimap table: %w", err)
	}
	table := map[string][]MapTile{}
	ParseMinimapIndex(raw).Each(func(name, file string) {
		m := minimapLine.FindStringSubmatch(name)
		if m == nil {
			return
		}
		x, _ := strconv.Atoi(m[2])
		y, _ := strconv.Atoi(m[3])
		if x < 0 || y < 0 || x >= MapTilesPerSide || y >= MapTilesPerSide {
			return
		}
		key := strings.ToLower(m[1])
		table[key] = append(table[key], MapTile{X: x, Y: y, File: `textures\Minimap\` + file})
	})
	for _, tiles := range table {
		sort.Slice(tiles, func(i, j int) bool {
			return tiles[i].Y < tiles[j].Y || tiles[i].Y == tiles[j].Y && tiles[i].X < tiles[j].X
		})
	}
	c.minimap = table
	return table, nil
}

// MapOverview returns a PNG of the whole map: 64x64 tiles of OverviewTilePx pixels each, from the
// client's minimap images, transparent where a tile doesn't exist. It is built once and kept in the
// user's cache folder.
func (c *Client) MapOverview(mapName string) ([]byte, error) {
	if mapName == "" || strings.ContainsAny(mapName, `\/`) {
		return nil, errors.New("bad map name")
	}
	path, err := c.cachePath("overview", mapName)
	if err != nil {
		return nil, err
	}
	if b, err := os.ReadFile(path); err == nil {
		return b, nil
	}
	tiles, err := c.MinimapTiles(mapName)
	if err != nil {
		return nil, err
	}
	if len(tiles) == 0 {
		return nil, fmt.Errorf("%s has no minimap tiles", mapName)
	}
	side := MapTilesPerSide * OverviewTilePx
	out := image.NewNRGBA(image.Rect(0, 0, side, side))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for _, t := range tiles {
		wg.Add(1)
		go func(t MapTile) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			raw, err := c.read(t.File)
			if err != nil {
				return
			}
			img, err := DecodeBLP(raw)
			if err != nil || img.W == 0 || img.H == 0 {
				return
			}
			// Box-filter the tile down to OverviewTilePx a side. Each tile writes its own pixels, so
			// the goroutines never touch the same bytes.
			for py := 0; py < OverviewTilePx; py++ {
				for px := 0; px < OverviewTilePx; px++ {
					x0 := px * img.W / OverviewTilePx
					x1 := (px + 1) * img.W / OverviewTilePx
					y0 := py * img.H / OverviewTilePx
					y1 := (py + 1) * img.H / OverviewTilePx
					var r, g, b, n int
					for y := y0; y < y1; y++ {
						for x := x0; x < x1; x++ {
							i := (y*img.W + x) * 4
							r += int(img.Pix[i])
							g += int(img.Pix[i+1])
							b += int(img.Pix[i+2])
							n++
						}
					}
					if n == 0 {
						continue
					}
					out.SetNRGBA(t.X*OverviewTilePx+px, t.Y*OverviewTilePx+py, color.NRGBA{uint8(r / n), uint8(g / n), uint8(b / n), 255})
				}
			}
		}(t)
	}
	wg.Wait()
	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
		_ = os.WriteFile(path, buf.Bytes(), 0o644)
	}
	return buf.Bytes(), nil
}

// cachePath is a file in the per-client cache folder, under `kind`, for `key`.
func (c *Client) cachePath(kind, key string) (string, error) {
	c.mu.RLock()
	dir, loaded := c.dir, c.set != nil
	c.mu.RUnlock()
	if !loaded || key == "" {
		return "", errors.New("no client or key")
	}
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "Meld", kind, hashHex(dir)[:12], hashHex(key)+".png"), nil
}
