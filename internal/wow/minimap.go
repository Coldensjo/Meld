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

	"Meld/internal/adt"
)

// The client's minimap: one 256x256 BLP per tile under textures\Minimap, named by hash, with
// textures\Minimap\md5translate.trs mapping "<Map>\map<x>_<y>.blp" to the hashed file. The editor
// stitches a whole map into one overview image so a region can be picked by eye.

// MapTile is a tile of a map. File is its minimap image, empty for a tile that has an ADT but no
// minimap (every tile of a 1.12 instance).
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
	// The read runs outside minimapMu: it may wait for a Resume, which forgets the table under c.mu.
	c.minimapMu.Lock()
	table, gen := c.minimap, c.minimapGen
	c.minimapMu.Unlock()
	if table != nil {
		return table, nil
	}
	raw, err := c.read(MinimapIndexPath)
	if err != nil {
		return nil, fmt.Errorf("minimap table: %w", err)
	}
	table = map[string][]MapTile{}
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
	c.minimapMu.Lock()
	if gen == c.minimapGen {
		c.minimap = table
	}
	c.minimapMu.Unlock()
	return table, nil
}

// MapTiles lists the tiles of mapName that exist: those its WDT's MAIN table marks as having an ADT,
// each with its minimap image where the client has one. Instances have no minimap at all, so the
// WDT is what says where their ground is (#222). Without a WDT it falls back to the minimap's list.
// A WMO-only map (one global building, no ADTs) has none.
func (c *Client) MapTiles(mapName string) ([]MapTile, error) {
	mini, err := c.MinimapTiles(mapName)
	if err != nil {
		mini = nil
	}
	wdt, err := c.read(fmt.Sprintf(`World\Maps\%s\%s.wdt`, mapName, mapName))
	if err != nil {
		if mini == nil {
			return []MapTile{}, nil
		}
		return mini, nil
	}
	files := make(map[[2]int]string, len(mini))
	for _, t := range mini {
		files[[2]int{t.X, t.Y}] = t.File
	}
	tiles := []MapTile{}
	for _, xy := range WDTTiles(wdt) {
		tiles = append(tiles, MapTile{X: xy[0], Y: xy[1], File: files[xy]})
	}
	return tiles, nil
}

// WDTTiles reads a WDT's MAIN table: the (x, y) of each tile flagged as having an ADT, row by row.
// MAIN holds 64x64 entries of 8 bytes, x + 64*y, whose first word has bit 0 set for a tile.
func WDTTiles(wdt []byte) [][2]int {
	out := [][2]int{}
	for off := 0; off+8 <= len(wdt); {
		id := string([]byte{wdt[off+3], wdt[off+2], wdt[off+1], wdt[off]})
		size := int(uint32(wdt[off+4]) | uint32(wdt[off+5])<<8 | uint32(wdt[off+6])<<16 | uint32(wdt[off+7])<<24)
		body := off + 8
		if size < 0 || body+size > len(wdt) {
			break
		}
		if id == "MAIN" {
			n := MapTilesPerSide * MapTilesPerSide
			for i := 0; i < n && body+i*8+4 <= body+size; i++ {
				if wdt[body+i*8]&1 != 0 {
					out = append(out, [2]int{i % MapTilesPerSide, i / MapTilesPerSide})
				}
			}
			break
		}
		off = body + size
	}
	return out
}

// MapOverview returns a PNG of the whole map: 64x64 tiles of OverviewTilePx pixels each, from the
// client's minimap images, transparent where a tile doesn't exist. A tile with no minimap image
// (all of an instance's) is drawn from its ADT's heights instead, shaded by slope, so an instance's
// ground can still be picked by eye. It is built once and kept in the user's cache folder.
func (c *Client) MapOverview(mapName string) ([]byte, error) {
	if mapName == "" || strings.ContainsAny(mapName, `\/`) {
		return nil, errors.New("bad map name")
	}
	// "overview2" since tiles without a minimap image are drawn from their heights (#222): an older
	// cached overview left them out.
	path, err := c.overviewPath(mapName)
	if err != nil {
		return nil, err
	}
	if b, err := os.ReadFile(path); err == nil {
		return b, nil
	}
	tiles, err := c.MapTiles(mapName)
	if err != nil {
		return nil, err
	}
	if len(tiles) == 0 {
		return nil, fmt.Errorf("%s has no terrain tiles", mapName)
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
			if t.File == "" {
				c.drawTileRelief(out, mapName, t)
				return
			}
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

// overviewPath is the cached overview of mapName. The key holds the archives' names, sizes and times,
// so a patch written with new tiles, minimap images or heights builds a new overview instead of
// showing the first one ever made (#493).
func (c *Client) overviewPath(mapName string) (string, error) {
	c.mu.RLock()
	stamps := c.stamps
	c.mu.RUnlock()
	return c.cachePath("overview2", mapName+"|"+hashHex(stamps))
}

// drawTileRelief draws a tile without a minimap image from its ADT: each overview pixel takes the
// height sample under it, lit from the north-west by the slope, so ridges, walls and pits show.
// A tile it cannot read is drawn flat grey, so it still shows as there.
func (c *Client) drawTileRelief(out *image.NRGBA, mapName string, t MapTile) {
	const side = adt.ChunksPerTile * adt.CellsPerChunk // 128 cells, 129 outer samples a side
	flat := color.NRGBA{90, 96, 104, 255}
	var h []float32
	if raw, err := c.read(adt.TilePath(mapName, t.X, t.Y, "")); err == nil {
		if g, err := TileGround(raw); err == nil {
			h = g.Heights
		}
	}
	at := func(x, y int) float32 {
		x = min(max(x, 0), side)
		y = min(max(y, 0), side)
		return h[y*(side+1)+x]
	}
	for py := 0; py < OverviewTilePx; py++ {
		for px := 0; px < OverviewTilePx; px++ {
			col := flat
			if h != nil {
				x := px * side / OverviewTilePx
				y := py * side / OverviewTilePx
				step := side / OverviewTilePx
				// A cell is 533.33/128 yards; the slope over one overview pixel, lit from the north-west.
				dx := at(x+step, y) - at(x-step, y)
				dy := at(x, y+step) - at(x, y-step)
				run := float32(2*step) * float32(adt.TileSize) / side
				light := 0.6 - 0.9*(dx+dy)/run
				light = min(max(light, 0.15), 1)
				col = color.NRGBA{uint8(140 * light), uint8(150 * light), uint8(130 * light), 255}
			}
			out.SetNRGBA(t.X*OverviewTilePx+px, t.Y*OverviewTilePx+py, col)
		}
	}
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
