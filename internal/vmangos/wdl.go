package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"

	"Meld/internal/mpq"
)

// The WDL holds a map's far horizon: per tile a coarse grid of heights the client draws past the
// tiles it has loaded, and so also which tiles there are. A 1.12 WDL is MVER (18), MAOF (the
// file offset of each tile's MARE, 0 for no tile) and one MARE per tile, with no MAHO.
const (
	// WDLOuter is the outer heights a side of a tile's MARE: one at each chunk corner.
	WDLOuter = ChunksPerTileSide + 1
	// WDLInner is the inner heights a side: one at each chunk's centre.
	WDLInner = ChunksPerTileSide
	// WDLHeights is the heights in a MARE: the outer grid, then the inner one.
	WDLHeights = WDLOuter*WDLOuter + WDLInner*WDLInner
)

// wdlPath is the WDL's name in the client's archives.
func wdlPath(mapName string) string {
	return fmt.Sprintf(`World\Maps\%s\%s.wdl`, mapName, mapName)
}

// WDLTile is a tile's MARE heights, in yards.
type WDLTile [WDLHeights]int16

// ParseWDL reads a WDL's tiles, keyed x + 64*y.
func ParseWDL(b []byte) (map[int]*WDLTile, error) {
	var maof []byte
	for o := 0; o+8 <= len(b); {
		id := string([]byte{b[o+3], b[o+2], b[o+1], b[o]})
		size := int(binary.LittleEndian.Uint32(b[o+4:]))
		if o+8+size > len(b) {
			return nil, errors.New("wdl: truncated chunk")
		}
		if id == "MAOF" {
			maof = b[o+8 : o+8+size]
			break
		}
		o += 8 + size
	}
	if len(maof) != MapTiles*MapTiles*4 {
		return nil, errors.New("wdl: no tile table")
	}
	tiles := map[int]*WDLTile{}
	for k := 0; k < MapTiles*MapTiles; k++ {
		off := int(binary.LittleEndian.Uint32(maof[k*4:]))
		if off == 0 {
			continue
		}
		if off+8+WDLHeights*2 > len(b) || string([]byte{b[off+3], b[off+2], b[off+1], b[off]}) != "MARE" {
			return nil, fmt.Errorf("wdl: tile %d has no heights at %d", k, off)
		}
		var t WDLTile
		for i := range t {
			t[i] = int16(binary.LittleEndian.Uint16(b[off+8+i*2:]))
		}
		tiles[k] = &t
	}
	return tiles, nil
}

// BuildWDL writes a WDL with the given tiles, keyed x + 64*y, their MAREs in tile order.
func BuildWDL(tiles map[int]*WDLTile) []byte {
	const head = 12 + 8 + MapTiles*MapTiles*4
	const mare = 8 + WDLHeights*2
	out := make([]byte, head, head+len(tiles)*mare)
	copy(out, []byte{'R', 'E', 'V', 'M', 4, 0, 0, 0, 18, 0, 0, 0, 'F', 'O', 'A', 'M'})
	binary.LittleEndian.PutUint32(out[16:], MapTiles*MapTiles*4)
	for k := 0; k < MapTiles*MapTiles; k++ {
		t := tiles[k]
		if t == nil {
			continue
		}
		binary.LittleEndian.PutUint32(out[20+k*4:], uint32(len(out)))
		var chunk [mare]byte
		copy(chunk[:], []byte{'E', 'R', 'A', 'M'})
		binary.LittleEndian.PutUint32(chunk[4:], WDLHeights*2)
		for i, h := range t {
			binary.LittleEndian.PutUint16(chunk[8+i*2:], uint16(h))
		}
		out = append(out, chunk[:]...)
	}
	return out
}

// WDLTileOf samples a tile's MARE from its outer heights, which start at outer[0] with stride
// heights a row (rows running south, LatticeSize a side). The outer grid is the height at each chunk
// corner, truncated as the client's own WDLs have it (they match it exactly); the inner one is the
// mean of the chunk's outer heights, which comes closer to theirs than its centre height does.
func WDLTileOf(outer []float32, stride int) *WDLTile {
	var t WDLTile
	const step = chunkCells
	clamp := func(h float64) int16 {
		return int16(max(math.MinInt16, min(math.MaxInt16, math.Trunc(h))))
	}
	for r := 0; r < WDLOuter; r++ {
		for c := 0; c < WDLOuter; c++ {
			t[r*WDLOuter+c] = clamp(float64(outer[r*step*stride+c*step]))
		}
	}
	for r := 0; r < WDLInner; r++ {
		for c := 0; c < WDLInner; c++ {
			sum := 0.0
			for y := r * step; y <= (r+1)*step; y++ {
				for x := c * step; x <= (c+1)*step; x++ {
					sum += float64(outer[y*stride+x])
				}
			}
			t[WDLOuter*WDLOuter+r*WDLInner+c] = clamp(sum / ((step + 1) * (step + 1)))
		}
	}
	return &t
}

// HorizonTile is one tile of a map's far horizon around an open block: where it lies in tiles from
// the block's first tile, and its WDL heights in yards (WDLOuter squared at the chunk corners, then
// WDLInner squared at the chunk centres, rows running south).
type HorizonTile struct {
	DX      int   `json:"dx"`
	DY      int   `json:"dy"`
	Heights []int `json:"heights"`
}

// ReadRegionHorizon reads the WDL tiles of the named map within radius tiles of the size x size block
// at (x, y), leaving out the block's own, as the client draws the horizon past the tiles it has loaded.
// A map without a WDL has no horizon.
func ReadRegionHorizon(dataDir, mapName string, x, y, size, radius int) ([]HorizonTile, error) {
	if err := checkRegion(x, y, size); err != nil {
		return nil, err
	}
	tiles, err := readWDL(dataDir, mapName)
	if err != nil || tiles == nil {
		return nil, err
	}
	var out []HorizonTile
	for ty := max(0, y-radius); ty < min(MapTiles, y+size+radius); ty++ {
		for tx := max(0, x-radius); tx < min(MapTiles, x+size+radius); tx++ {
			if tx >= x && tx < x+size && ty >= y && ty < y+size {
				continue
			}
			if t := tiles[tx+MapTiles*ty]; t != nil {
				out = append(out, horizonTile(t, tx-x, ty-y))
			}
		}
	}
	return out, nil
}

// ReadWorldHorizon reads every WDL tile of the named map, for the world view's horizon past the tiles
// it streams (#15): DX and DY are the tile's own coordinates. A map without a WDL has no horizon.
func ReadWorldHorizon(dataDir, mapName string) ([]HorizonTile, error) {
	tiles, err := readWDL(dataDir, mapName)
	if err != nil || tiles == nil {
		return nil, err
	}
	var out []HorizonTile
	for i := 0; i < MapTiles*MapTiles; i++ {
		if t := tiles[i]; t != nil {
			out = append(out, horizonTile(t, i%MapTiles, i/MapTiles))
		}
	}
	return out, nil
}

// readWDL reads the named map's WDL through the client's archives (Meld's patch included), nil when
// the map has none.
func readWDL(dataDir, mapName string) (map[int]*WDLTile, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	b, err := set.ReadFile(wdlPath(mapName))
	if err != nil {
		return nil, nil
	}
	return ParseWDL(b)
}

// horizonTile is WDL tile t placed at (dx, dy).
func horizonTile(t *WDLTile, dx, dy int) HorizonTile {
	h := HorizonTile{DX: dx, DY: dy, Heights: make([]int, WDLHeights)}
	for i, v := range t {
		h.Heights[i] = int(v)
	}
	return h
}
